import { Service, State } from 'iw-base/lib/registry';
import * as logging from 'iw-base/lib/logging';
import { IwDeepstreamClient } from 'iw-base/modules/deepstream-client';
import { Record } from '@deepstream/client/dist/record/record';
import * as mqtt from 'mqtt';

const log = logging.getLogger('PaulmannRemote');

export interface PaulmannRemoteConfig {
  mqttUrl: string;
  mqttDeviceName: string;
  lightDevices: LightDeviceConfig[];
}

export interface LightDeviceConfig {
  recordName: string;
  setOnOff: (state: any, on: boolean) => any;
  incrementBrightness: (state: any) => any;
  decrementBrightness: (state: any) => any;
  setBrightnessPercent: (state: any, brightness: number) => any;
  setColorTempPercent: (state: any, colorTemp: number) => any;
  setHue: (state: any, hue: number) => any;
  setSaturation: (state: any, saturation: number) => any;
}

enum LightMode {
  RGB,
  WHITE
}

interface LightDevice extends LightDeviceConfig {
  record: Record;
  lightMode: LightMode;
}

export class PaulmannRemote extends Service {

  private client: mqtt.Client;
  private lightDevices: LightDevice[];
  private brightnessMoveTimer: NodeJS.Timeout;
  private moveCancelTimer: NodeJS.Timeout;
  private modeSwitchCount = 0;

  constructor(private ds: IwDeepstreamClient) {
    super('paulmann-remote');
  }

  async start(config: PaulmannRemoteConfig) {
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
        lightMode: LightMode.WHITE,
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
    log.debug(message, `received action ${message.action}`);
    const lightDevice = this.lightDevices[message.action_group - 1];
    if (lightDevice === undefined) {
      log.debug(`no device configured for action group ${message.action_group}`);
      return;
    }
    const lightState = lightDevice.record.get();
    switch (message.action) {
      case 'on': {
        const command = lightDevice.setOnOff(lightState, true);
        this.setCommand(lightDevice, command);
        break;
      }
      case 'off': {
        const command = lightDevice.setOnOff(lightState, false);
        this.setCommand(lightDevice, command);
        break;
      }
      case 'brightness_move_up': {
        this.cancelMove();
        const moveBrightness = () => {
          const command = lightDevice.incrementBrightness(lightState);
          this.setCommand(lightDevice, command);
        };
        moveBrightness();
        this.brightnessMoveTimer = setInterval(moveBrightness, 500);
        this.moveCancelTimer = setTimeout(() => this.cancelMove(), 10000);
        break;
      }
      case 'brightness_move_down': {
        this.cancelMove();
        const moveBrightness = () => {
          const command = lightDevice.decrementBrightness(lightState);
          this.setCommand(lightDevice, command);
        };
        moveBrightness();
        this.brightnessMoveTimer = setInterval(moveBrightness, 500);
        this.moveCancelTimer = setTimeout(() => this.cancelMove(), 10000);
        break;
      }
      case 'brightness_stop': {
        this.cancelMove();
        break;
      }
      case 'color_temperature_move': {
          let colorTempValue = message.action_color_temperature;
          if (colorTempValue === 286 && this.modeSwitchCount === 0) {
            this.modeSwitchCount = 1;
            return;
          } else if (colorTempValue === 286 && this.modeSwitchCount === 1) {
            this.modeSwitchCount = 0;
            lightDevice.lightMode = LightMode.WHITE;
            colorTempValue = 370;
          } else {
            this.modeSwitchCount = 0;
          }
          if (lightDevice.lightMode === LightMode.RGB) {
            const satPercent = (colorTempValue - 153) / 217;
            const command = lightDevice.setSaturation(lightState, satPercent);
            this.setCommand(lightDevice, command);
          } else {
            const colorTempPercent = (colorTempValue - 153) / 217;
            const command = lightDevice.setColorTempPercent(lightState, colorTempPercent);
            this.setCommand(lightDevice, command);
          }
          break;
        }
      case 'enhanced_move_to_hue_and_saturation': {
        const hue = message.action_hue;
        const command = lightDevice.setHue(lightState, hue);
        this.setCommand(lightDevice, command);
        lightDevice.lightMode = LightMode.RGB;
      }
    }
  }

  setCommand(lightDevice: LightDevice, command: any) {
    log.debug(command, `updating light record ${lightDevice.recordName}`);
    lightDevice.record.set(command);
  }

  private cancelMove() {
    if (this.brightnessMoveTimer) {
      clearInterval(this.brightnessMoveTimer);
      this.brightnessMoveTimer = undefined;
    }
    if (this.moveCancelTimer) {
      clearTimeout(this.moveCancelTimer);
      this.moveCancelTimer = undefined;
    }
  }
}
