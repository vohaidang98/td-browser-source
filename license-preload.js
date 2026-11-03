'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('licenseApi', {
  submit: code => ipcRenderer.invoke('license:submit', String(code)),
  cancel: () => ipcRenderer.invoke('license:cancel')
});
