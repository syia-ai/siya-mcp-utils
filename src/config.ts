import { Config } from './types/index';

let _config: Config | null = null;

export function setConfig(config: Config) {
  _config = config;
}

export function getConfig(): Config {
  if (!_config) {
    throw new Error("Config not set. Call setConfig(config) in server startup.");
  }
  return _config;
} 