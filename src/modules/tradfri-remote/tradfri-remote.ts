import { Service, State } from 'iw-base/lib/registry';
import * as logging from 'iw-base/lib/logging';
import { IwDeepstreamClient } from 'iw-base/modules/deepstream-client';
import { Record } from '@deepstream/client/dist/record/record';
import * as mqtt from 'mqtt';
import { assign } from 'lodash';

const COLORS = [
  { color_temp_percent: 100 },
  { color_temp_percent: 50 },
  { color_temp_percent: 0 },
  { color: { r: 255, g: 147, b:  41 } }, /* candle */
  { color: { r: 255, g: 179, b: 102 } }, /* candle 2 */
  { color: { r: 255, g: 244, b: 229 } }, /* warm white */
  { color: { r: 255, g: 255, b: 251 } }, /* high noon sun */
  { color: { r: 255, g: 117, b: 107 } }, /* aprikose */
  { color: { r: 255, g: 216, b:  77 } }, /* lemon */
  { color: { r:  97, g: 255, b: 121 } }, /* gloom */
  { color: { r: 108, g: 148, b: 122 } }, /* green/gray */
  { color: { r: 191, g: 102, b: 255 } }, /* flieder */
  { color: { r:  64, g: 156, b: 255 } } /* blue sky */
];

const log = logging.getLogger('TradfriRemote');

export interface TradfriRemoteConfig {
  mqttUrl: string;
  mqttDeviceName: string;
  lightRecord: string;
}

export class TradfriRemote extends Service {

  private client: mqtt.Client;
  private lightRecord: Record;
  private colorIndex = 0;

  constructor(private ds: IwDeepstreamClient) {
    super('tradfri-remote');
  }

  async start(config: TradfriRemoteConfig) {
    this.setState(State.BUSY);
    await new Promise((resolve, reject) => {
      const remoteTopic = `zigbee2mqtt/${config.mqttDeviceName}`;

      this.client = mqtt.connect(config.mqttUrl);
      this.client.on('connect', () => {
        this.client.subscribe(remoteTopic, (err) => err ? reject(err) : resolve());
      });
      this.client.on('message', (topic, payload) => {
        if (topic === remoteTopic) {
          const payloadJSON = JSON.parse(payload.toString('utf8'));
          this.handleMessage(payloadJSON);
        }
      });
    });
    this.lightRecord = this.ds.getRecord(config.lightRecord);
    await this.lightRecord.whenReady();
    this.setState(State.OK);
  }

  async stop() {
    await new Promise((resolve, reject) => {
    this.client.end(undefined, undefined, resolve);
    });
    this.lightRecord.discard();
    this.setState(State.INACTIVE);
  }

  private handleMessage(message: any) {
    const lightState = this.lightRecord.get();
    switch (message.action) {
      case 'toggle': {
        let state = lightState.state ?? 'OFF';
        if (state === 'ON') {
          state = 'OFF';
        } else {
          state = 'ON';
        }
        lightState.state = state;
        break;
      }
      case 'brightness_up_click': {
        let brightness = lightState.brightness ?? 255;
        brightness = Math.min(255, brightness + 25);
        lightState.brightness = brightness;
        break;
      }
      case 'brightness_down_click': {
        let brightness = lightState.brightness ?? 255;
        brightness = Math.max(5, brightness - 25);
        lightState.brightness = brightness;
        break;
      }
      case 'brightness_up_hold': {
        let brightness = lightState.brightness ?? 255;
        if (brightness < 80) {
          brightness = 80;
        } else {
          brightness = 255;
        }
        lightState.brightness = brightness;
        break;
      }
      case 'brightness_down_hold': {
        let brightness = lightState.brightness ?? 255;
        if (brightness > 80) {
          brightness = 80;
        } else {
          brightness = 5;
        }
        lightState.brightness = brightness;
        break;
      }
      case 'arrow_left_click': {
        this.colorIndex = (this.colorIndex - 1 + COLORS.length) % COLORS.length;
        this.setColor(lightState, COLORS[this.colorIndex]);
        break;
      }
      case 'arrow_right_click': {
        this.colorIndex = (this.colorIndex + 1) % COLORS.length;
        this.setColor(lightState, COLORS[this.colorIndex]);
        break;
      }
      case 'arrow_left_hold': {
        this.colorIndex = 0;
        this.setColor(lightState, COLORS[this.colorIndex]);
        break;
      }
    }
    log.debug(lightState, `updating light record ${this.lightRecord.name}`);
    this.lightRecord.set(assign({}, lightState, { from: 'control' }));
  }

  setColor(lightState: any, color: any) {
    /* when color_temp is present, the controller ignores color,
     * therefore remove all color related properties before setting
     * a new color */
    delete lightState.color;
    delete lightState.color_temp;
    delete lightState.color_temp_percent;
    return assign(lightState, color);
  }
}
