let _config: any = null;

export function setConfig(config: any) {
  _config = config;
}

export function getConfig() {
  if (!_config) {
    throw new Error("Config not set. Call setConfig(config) in server startup.");
  }
  return _config;
}

// Export config as default for easier importing
export { getConfig as config }; 