import { IwDeepstreamClient } from 'iw-base/modules/deepstream-client';
import { UdpDiscovery } from 'iw-base/modules/udp-discovery';
import { TradfriRemote, TradfriRemoteConfig } from './modules/tradfri-remote';
import { LightDeviceConfig, LightDevice } from './modules/light-device';

const REMOTE_CONFIG: TradfriRemoteConfig = {
  lightRecord: 'light-control/devices/TV Light',
  mqttDeviceName: 'Tradfri Remote 1',
  mqttUrl: 'mqtt://helios4.local'
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
