'use strict'
const path = require('node:path')
const fakeHub = require(path.resolve(__dirname, 'fakeAPIserver.js'))

// let fakeHubReady = false

async function startHub (params) {
  try {
    await fakeHub(5)
  } catch (error) {
    if (String(error) === 'Error: listen EADDRINUSE: address already in use :::8443') {
      console.log('Fake hub is running elsewhere. Reusing that connection')
    } else {
      console.error(String(error))
      process.exit(1)
    }
  }
  // fakeHubReady = true
}
startHub()
