import { IwDeepstreamClient } from 'iw-base/modules/deepstream-client';
import { UdpDiscovery } from 'iw-base/modules/udp-discovery';
import { TradfriRemote, TradfriRemoteConfig } from './modules/tradfri-remote';
import { LightDeviceConfig, LightDevice } from './modules/light-device';

const REMOTE_CONFIG: TradfriRemoteConfig = {
  mqttDeviceName: 'Tradfri Remote 1',
  mqttUrl: 'mqtt://helios4.local',
  lightDevices: [
    {
      recordName: 'light-control/devices/TV Light',
      brightnessConfig: {
        prop: 'brightness',
        steps: 255
      },
      onState: {
        state: 'ON'
      },
      offState: {
        state: 'OFF'
      },
      transitionState: {
        transition: 0.2
      },
      noTransitionState: {
        transition: 0
      },
      templates: [
        { color_temp: undefined, color_temp_percent: 100, color: undefined },
        { color_temp: undefined, color_temp_percent: 50, color: undefined },
        { color_temp: undefined, color_temp_percent: 0, color: undefined },
        { color_temp: undefined, color_temp_percent: undefined, color: { r: 255, g: 147, b:  41 } }, /* candle */
        { color_temp: undefined, color_temp_percent: undefined, color: { r: 255, g: 179, b: 102 } }, /* candle 2 */
        { color_temp: undefined, color_temp_percent: undefined, color: { r: 255, g: 117, b: 107 } }, /* aprikose */
        { color_temp: undefined, color_temp_percent: undefined, color: { r: 255, g: 216, b:  77 } }, /* lemon */
        { color_temp: undefined, color_temp_percent: undefined, color: { r:  97, g: 255, b: 121 } }, /* gloom */
        { color_temp: undefined, color_temp_percent: undefined, color: { r: 108, g: 148, b: 122 } }, /* green/gray */
        { color_temp: undefined, color_temp_percent: undefined, color: { r: 191, g: 102, b: 255 } }, /* flieder */
        { color_temp: undefined, color_temp_percent: undefined, color: { r:  64, g: 156, b: 255 } } /* blue sky */
      ]
    },
    {
      recordName: 'light-control/devices/Living Room',
      brightnessConfig: {
        prop: 'brightness',
        steps: 1
      },
      onState: {
        brightness: 1
      },
      offState: {
        brightness: 0
      },
      transitionState: {
        fade: true
      },
      noTransitionState: {
        fade: false
      },
      templates: [
        { value: { r: 255, g: 134, b:  41, w:   0 }, correction: { r: 255, g: 224, b: 140 } }, /* candle 3 */
        { value: { r: 255, g: 134, b:  41, w:  50 }, correction: { r: 255, g: 224, b: 140 } }, /* candle 3 with white */
        { value: { r: 255, g: 134, b:  41, w: 255 }, correction: { r: 255, g: 224, b: 140 } }, /* candle 3 with white */
        { value: { r: 255, g: 147, b:  41, w:   0 }, correction: { r: 255, g: 224, b: 140 } }, /* candle */
        { value: { r: 255, g: 117, b: 107, w:   0 }, correction: { r: 255, g: 224, b: 140 } }, /* aprikose */
        { value: { r: 255, g: 216, b:  77, w:   0 }, correction: { r: 255, g: 224, b: 140 } }, /* lemon */
        { value: { r:  97, g: 255, b: 121, w:   0 }, correction: { r: 255, g: 224, b: 140 } }, /* gloom */
        { value: { r: 108, g: 148, b: 122, w:   0 }, correction: { r: 255, g: 224, b: 140 } }, /* green/gray */
        { value: { r: 191, g: 102, b: 255, w:   0 }, correction: { r: 255, g: 224, b: 140 } }, /* flieder */
        { value: { r:  64, g: 156, b: 255, w:   0 }, correction: { r: 255, g: 224, b: 140 } } /* blue sky */
      ]
    }
  ]
};

const LIGHT_CONFIG: LightDeviceConfig = {
  lightRecord: 'light-control/devices/TV Light',
  mqttDeviceName: 'TV Light',
  mqttUrl: 'mqtt://helios4.local'
};

const client = new IwDeepstreamClient();
const discovery = new UdpDiscovery(client);
const tradfriRemote = new TradfriRemote(client);
const lightDevice = new LightDevice(client);
discovery.start({ requestPort: 6031 });

client.on('connected', () => {
  tradfriRemote.start(REMOTE_CONFIG);
  lightDevice.start(LIGHT_CONFIG);
});
