import { Service, State } from 'iw-base/lib/registry';
import * as logging from 'iw-base/lib/logging';
import { IwDeepstreamClient } from 'iw-base/modules/deepstream-client';
import { Record } from '@deepstream/client/dist/record/record';
import * as mqtt from 'mqtt';
import { assign, pick, keys, isEqual } from 'lodash';

const COLORS = [

];

const log = logging.getLogger('TradfriRemote');

export interface TradfriRemoteConfig {
  mqttUrl: string;
  mqttDeviceName: string;
  lightDevices: LightDeviceConfig[];
}

export interface LightDeviceConfig {
  recordName: string;
  templates: any[];
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
          command = assign({}, lightState, lightDevice.offState);
        } else {
          command = assign({}, lightState, lightDevice.onState);
        }
        this.setCommand(lightDevice, command);
        break;
      }
      case 'brightness_up_click': {
        let brightness = lightState[lightDevice.brightnessConfig.prop] ?? lightDevice.brightnessConfig.steps;
        brightness = Math.min(lightDevice.brightnessConfig.steps, brightness + (lightDevice.brightnessConfig.steps / 10));
        const command = assign({}, lightState, { [lightDevice.brightnessConfig.prop]: brightness });
        this.setCommand(lightDevice, command);
        break;
      }
      case 'brightness_down_click': {
        let brightness = lightState[lightDevice.brightnessConfig.prop] ?? lightDevice.brightnessConfig.steps;
        brightness = Math.max(0, brightness - (lightDevice.brightnessConfig.steps / 10));
        const command = assign({}, lightState, { [lightDevice.brightnessConfig.prop]: brightness });
        this.setCommand(lightDevice, command);
        break;
      }
      case 'brightness_up_hold': {
        let brightness = lightState[lightDevice.brightnessConfig.prop] ?? lightDevice.brightnessConfig.steps;
        if (brightness < lightDevice.brightnessConfig.steps / 3) {
          brightness = lightDevice.brightnessConfig.steps / 3;
        } else {
          brightness = lightDevice.brightnessConfig.steps;
        }
        const command = assign({}, lightState, { [lightDevice.brightnessConfig.prop]: brightness }, lightDevice.transitionState);
        this.setCommand(lightDevice, command);
        break;
      }
      case 'brightness_down_hold': {
        // let brightness = lightState.brightness ?? 255;
        // if (brightness > 80) {
        //   brightness = 80;
        // } else {
        //   brightness = 5;
        // }
        // this.setCommand({ transition: 0.2, brightness });
        let brightness = lightState[lightDevice.brightnessConfig.prop] ?? lightDevice.brightnessConfig.steps;
        if (brightness > lightDevice.brightnessConfig.steps / 3) {
          brightness = lightDevice.brightnessConfig.steps / 3;
        } else {
          brightness = lightDevice.brightnessConfig.steps * 0.02;
        }
        const command = assign({}, lightState, { [lightDevice.brightnessConfig.prop]: brightness }, lightDevice.transitionState);
        this.setCommand(lightDevice, command);
        break;
      }
      case 'arrow_left_click': {
        lightDevice.templateIndex = (lightDevice.templateIndex - 1 + lightDevice.templates.length) % lightDevice.templates.length;
        const command = assign({}, lightState, lightDevice.templates[lightDevice.templateIndex]);
        this.setCommand(lightDevice, command);
        break;
      }
      case 'arrow_right_click': {
        lightDevice.templateIndex = (lightDevice.templateIndex + 1) % lightDevice.templates.length;
        const command = assign({}, lightState, lightDevice.templates[lightDevice.templateIndex]);
        this.setCommand(lightDevice, command);
        break;
      }
      case 'arrow_left_hold': {
        lightDevice.templateIndex = 0;
        const command = assign({}, lightState, lightDevice.templates[lightDevice.templateIndex]);
        this.setCommand(lightDevice, command);
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
    lightDevice.record.set(assign({}, command, { from: 'control' }));
  }
}
