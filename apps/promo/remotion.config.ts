import { Config } from '@remotion/cli/config';

Config.setVideoImageFormat('jpeg');
Config.setJpegQuality(95);
Config.setPixelFormat('yuv420p');
Config.setCodec('h264');
Config.setCrf(16);
Config.setAudioCodec('aac');
Config.setAudioBitrate('320k');
Config.setConcurrency(4);
Config.setDelayRenderTimeoutInMilliseconds(120000);
