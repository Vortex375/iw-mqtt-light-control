import { Service, State } from 'iw-base/lib/registry';
import * as logging from 'iw-base/lib/logging';
import { IwDeepstreamClient } from 'iw-base/modules/deepstream-client';
import { Component, Inject, Scoped } from 'iw-ioc';
import { Record } from '@deepstream/client/dist/src/record/record';
import * as mqtt from 'mqtt';
import { assign, pick, keys, isEqual, forEach, mapValues } from 'lodash';

const log = logging.getLogger('PhilipsDimmerSwitch');

export interface PhilipsDimmerSwitchConfig {
  mqttUrl: string;
  mqttDeviceName: string;
  lightDevices: LightDeviceConfig[];
}

export interface LightDeviceConfig {
  recordName: string;
  templates: any[];
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

@Component('philips-dimmer-switch')
@Scoped()
@Inject([IwDeepstreamClient])
export class PhilipsDimmerSwitch extends Service {

  private client: mqtt.Client;
  private lightDevices: LightDevice[];
  private deviceIndex = 0;

  constructor(private ds: IwDeepstreamClient) {
    super('philips-dimmer-switch');
  }

  async start(config: PhilipsDimmerSwitchConfig) {
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
    await new Promise<void>((resolve, reject) => {
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
      case 'on-press': {
        if (this.isState(lightState, lightDevice.onState)) {
          log.debug('device is on, cycling template');
          lightDevice.templateIndex = (lightDevice.templateIndex + 1) % lightDevice.templates.length;
          log.debug({ templateIndex: lightDevice.templateIndex }, 'cycle template right');
          const command = assign({}, lightDevice.resetTemplate, lightDevice.onState, lightDevice.noTransitionState,
              lightDevice.templates[lightDevice.templateIndex]);
          this.setCommand(lightDevice, command);
          break;
        } else {
          log.debug('device is off, turning on');
          const command = assign({}, lightDevice.onState);
          this.setCommand(lightDevice, command);
        }
        break;
      }
      case 'on-hold': {
        lightDevice.templateIndex = 0;
        log.debug({ templateIndex: lightDevice.templateIndex }, 'reset template');
        const command = assign({}, lightDevice.resetTemplate, lightDevice.onState, lightDevice.noTransitionState,
            lightDevice.templates[lightDevice.templateIndex]);
        this.setCommand(lightDevice, command);
        break;
      }
      case 'off-press': {
        if (message.counter === 1) {
          log.debug('turning device off');
          const command = assign({}, lightDevice.offState);
          this.setCommand(lightDevice, command);
        } else {
          this.deviceIndex = (this.deviceIndex + 1) % this.lightDevices.length;
          log.debug({ deviceIndex: this.deviceIndex, device: this.lightDevices[this.deviceIndex].recordName }, 'cycle device');
        }
        break;
      }
      case 'up-press': {
        const command = assign({}, { brightness_step: 25 });
        this.setCommand(lightDevice, command);
        break;
      }
      case 'up-hold': {
        const command = assign({}, { brightness_move: 80 });
        this.setCommand(lightDevice, command);
        break;
      }
      case 'up-hold-release': {
        const command = assign({}, {brightness_move: 0 });
        this.setCommand(lightDevice, command);
        break;
      }
      case 'down-press': {
        const command = assign({}, { brightness_step: -25 });
        this.setCommand(lightDevice, command);
        break;
      }
      case 'down-hold': {
        const command = assign({}, { brightness_move: -80 });
        this.setCommand(lightDevice, command);
        break;
      }
      case 'down-hold-release': {
        const command = assign({}, {brightness_move: 0 });
        this.setCommand(lightDevice, command);
        break;
      }
    }
  }

  private isState(lightState: object, stateObj: object) {
    return isEqual(pick(lightState, keys(stateObj)), stateObj);
  }

  setCommand(lightDevice: LightDevice, command: any) {
    /* replace null with undefined in the command */
    command = mapValues(command, (value) => value === null ? undefined : value);
    log.debug(command, `updating light record ${lightDevice.recordName}`);
    const isLowBrightness = command[lightDevice.brightnessConfig.prop] !== undefined
                            && command[lightDevice.brightnessConfig.prop] < lightDevice.brightnessConfig.steps * 0.2;
    if (isLowBrightness && this.isState(command, lightDevice.transitionState)) {
      /* for whatever reason, specifying "transition" with small brightness values
       * causes the light to turn off */
      assign(command, lightDevice.noTransitionState);
    }
    lightDevice.record.set({}, () => {
      lightDevice.record.set(command);
    });
  }
}
