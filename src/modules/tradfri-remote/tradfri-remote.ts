import { Service, State } from 'iw-base/lib/registry';
import * as logging from 'iw-base/lib/logging';
import { IwDeepstreamClient } from 'iw-base/modules/deepstream-client';
import { Record } from '@deepstream/client/dist/record/record';
import * as mqtt from 'mqtt';
import { assign, pick, keys, isEqual } from 'lodash';

const log = logging.getLogger('TradfriRemote');

export interface TradfriRemoteConfig {
  mqttUrl: string;
  mqttDeviceName: string;
  lightDevices: LightDeviceConfig[];
}

export interface LightDeviceConfig {
  recordName: string;
  templates: any[];
  commandTemplate?: object;
  resetTemplate?: object;
  brightnessConfig: {
    prop: string;
    steps: number;
  };
  onState: object;
  offState: object;
  transitionState: object;
  noTransitionState: object;
}

interface LightDevice extends LightDeviceConfig {
  templateIndex: number;
  record: Record;
}

export class TradfriRemote extends Service {

  private client: mqtt.Client;
  private lightDevices: LightDevice[];
  private deviceIndex = 0;

  constructor(private ds: IwDeepstreamClient) {
    super('tradfri-remote');
  }

  async start(config: TradfriRemoteConfig) {
    this.setServiceName(config.mqttDeviceName);
    this.setState(State.BUSY);
    await new Promise((resolve, reject) => {
      const remoteTopic = `zigbee2mqtt/${config.mqttDeviceName}`;

      this.client = mqtt.connect(config.mqttUrl);
      this.client.on('connect', () => {
        this.client.subscribe(remoteTopic, (err) => err ? reject(err) : resolve());
      });
      this.client.on('message', (topic, payload) => {
        if (topic === remoteTopic) {
          const payloadString = payload.toString('utf8');
          try {
            const payloadJSON = JSON.parse(payloadString);
            this.handleMessage(payloadJSON);
          } catch (err) {
            log.error({ err, message: payloadString }, 'unable to parse device message');
          }
        }
      });
    });
    this.lightDevices = await Promise.all(config.lightDevices.map(async (deviceConfig) => {
      const lightDevice: LightDevice = {
        ...deviceConfig,
        templateIndex: 0,
        record: this.ds.getRecord(deviceConfig.recordName)
      };
      await lightDevice.record.whenReady();
      return lightDevice;
    }));
    this.setState(State.OK);
  }

  async stop() {
    await new Promise((resolve, reject) => {
    this.client.end(undefined, undefined, resolve);
    });
    this.lightDevices.forEach((lightDevice) => {
      lightDevice.record.discard();
    });
    this.setState(State.INACTIVE);
  }

  private handleMessage(message: any) {
    const lightDevice = this.lightDevices[this.deviceIndex];
    const lightState = lightDevice.record.get();
    log.debug(message, `received action ${message.action}`);
    switch (message.action) {
      case 'toggle': {
        let command: any;
        if (this.isState(lightState, lightDevice.onState)) {
          log.debug('device is on, turning off');
          command = assign({}, lightState, lightDevice.commandTemplate, lightDevice.offState);
        } else {
          log.debug('device is off, turning on');
          command = assign({}, lightState, lightDevice.commandTemplate, lightDevice.onState);
        }
        this.setCommand(lightDevice, command);
        break;
      }
      case 'brightness_up_click': {
        const brightnessOld = lightState[lightDevice.brightnessConfig.prop] ?? lightDevice.brightnessConfig.steps;
        const brightnessNew = Math.min(lightDevice.brightnessConfig.steps, brightnessOld + (lightDevice.brightnessConfig.steps / 10));
        log.debug({ brightnessOld, brightnessNew }, 'brightness step up');
        const command = assign({}, lightState, lightDevice.commandTemplate, lightDevice.onState, { [lightDevice.brightnessConfig.prop]: brightnessNew });
        this.setCommand(lightDevice, command);
        break;
      }
      case 'brightness_down_click': {
        const brightnessOld = lightState[lightDevice.brightnessConfig.prop] ?? lightDevice.brightnessConfig.steps;
        const brightnessNew = Math.max(0, brightnessOld - (lightDevice.brightnessConfig.steps / 10));
        log.debug({ brightnessOld, brightnessNew }, 'brightness step down');
        const command = assign({}, lightState, lightDevice.commandTemplate, lightDevice.onState, { [lightDevice.brightnessConfig.prop]: brightnessNew });
        this.setCommand(lightDevice, command);
        break;
      }
      case 'brightness_up_hold': {
        const brightnessOld = lightState[lightDevice.brightnessConfig.prop] ?? lightDevice.brightnessConfig.steps;
        let brightnessNew: number;
        if (brightnessOld < lightDevice.brightnessConfig.steps / 3) {
          brightnessNew = lightDevice.brightnessConfig.steps / 3;
        } else {
          brightnessNew = lightDevice.brightnessConfig.steps;
        }
        log.debug({ brightnessOld, brightnessNew }, 'brightness leap up');
        const command = assign({}, lightState, lightDevice.commandTemplate, lightDevice.onState,
            { [lightDevice.brightnessConfig.prop]: brightnessNew }, lightDevice.transitionState);
        this.setCommand(lightDevice, command);
        break;
      }
      case 'brightness_down_hold': {
        const brightnessOld = lightState[lightDevice.brightnessConfig.prop] ?? lightDevice.brightnessConfig.steps;
        let brightnessNew: number;
        if (brightnessOld > lightDevice.brightnessConfig.steps / 3) {
          brightnessNew = lightDevice.brightnessConfig.steps / 3;
        } else {
          brightnessNew = lightDevice.brightnessConfig.steps * 0.02;
        }
        log.debug({ brightnessOld, brightnessNew }, 'brightness leap down');
        const command = assign({}, lightState, lightDevice.commandTemplate, lightDevice.onState,
            { [lightDevice.brightnessConfig.prop]: brightnessNew }, lightDevice.transitionState);
        this.setCommand(lightDevice, command);
        break;
      }
      case 'arrow_left_click': {
        lightDevice.templateIndex = (lightDevice.templateIndex - 1 + lightDevice.templates.length) % lightDevice.templates.length;
        log.debug({ templateIndex: lightDevice.templateIndex }, 'cycle template left');
        const command = assign({}, lightState, lightDevice.commandTemplate, lightDevice.resetTemplate, lightDevice.templates[lightDevice.templateIndex]);
        this.setCommand(lightDevice, command);
        break;
      }
      case 'arrow_right_click': {
        lightDevice.templateIndex = (lightDevice.templateIndex + 1) % lightDevice.templates.length;
        log.debug({ templateIndex: lightDevice.templateIndex }, 'cycle template right');
        const command = assign({}, lightState, lightDevice.commandTemplate, lightDevice.resetTemplate, lightDevice.templates[lightDevice.templateIndex]);
        this.setCommand(lightDevice, command);
        break;
      }
      case 'arrow_left_hold': {
        lightDevice.templateIndex = 0;
        log.debug({ templateIndex: lightDevice.templateIndex }, 'reset template');
        const command = assign({}, lightState, lightDevice.commandTemplate, lightDevice.resetTemplate, lightDevice.templates[lightDevice.templateIndex]);
        this.setCommand(lightDevice, command);
        break;
      }
      case 'arrow_right_hold': {
        this.deviceIndex = (this.deviceIndex + 1) % this.lightDevices.length;
        log.debug({ deviceIndex: this.deviceIndex, device: this.lightDevices[this.deviceIndex].recordName }, 'cycle device');
        break;
      }
    }
  }

  private isState(lightState: object, stateObj: object) {
    return isEqual(pick(lightState, keys(stateObj)), stateObj);
  }

  setCommand(lightDevice: LightDevice, command: any) {
    log.debug(command, `updating light record ${lightDevice.recordName}`);
    const isLowBrightness = command[lightDevice.brightnessConfig.prop] !== undefined
                            && command[lightDevice.brightnessConfig.prop] < lightDevice.brightnessConfig.steps * 0.2;
    if (isLowBrightness && this.isState(command, lightDevice.transitionState)) {
      /* for whatever reason, specifying "transition" with small brightness values
       * causes the light to turn off */
      assign(command, lightDevice.noTransitionState);
    }
    lightDevice.record.set(command);
  }
}
