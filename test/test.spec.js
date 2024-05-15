'use strict'
const path = require('node:path')
const MyUplinkClient = require(path.resolve(__dirname, '../index.js'))
const fakeServer = require(path.resolve(__dirname, 'fakeAPIserver.js'))

let fakeServerReader = false

async function promiseTimeout (delay) {
  console.log('promiseTimeout called waiting for', delay, 'ms')
  return new Promise(resolve => setTimeout(resolve, delay))
}

async function startHub (params) {
  try {
    await fakeServer(3)
  } catch (error) {
    if (String(error) === 'Error: listen EADDRINUSE: address already in use :::8443') {
      console.log('Fake hub is running elsewhere. Reusing that connection')
    } else {
      console.error(String(error))
      process.exit(1)
    }
  }
  fakeServerReader = true
}
startHub()

async function startTest (params) {
  let counter = 0
  while (fakeServerReader === false) {
    await promiseTimeout(300)
    counter++
    if (counter > 200) {
      fakeServerReader = false
      throw new Error('Error: Fake hub never became available')
    }
  }
  await promiseTimeout(300)
  try {
    const myUplinkClient = new MyUplinkClient({
      debug: 3,
      clientId: '731e62a0-c44d-4f52-957b-48bfd2675217',
      clientSecret: '38F1A95B2E7A251C7FDEEF2036EEE629',
      systemId: undefined,
      authCode: 'asqwertgfdsadfvbcxzdfdsasfgddeqwrfew342we4r32345refdsgdwe32345tyrfdsad',
      scope: 'READSYSTEM WRITESYSTEM offline_access',
      sessionStore: path.join(__dirname, 'test.session.json')
    })
    // console.log('1initState',myUplinkClient.initState)
    console.log('Test url used: ' + myUplinkClient._setAPIUrl('localhost:8443'))
    // console.log(myUplinkClient._testUrl('127.0.0.1:8443'))

    // console.log(myUplinkClient._testUrl('::1:8443'))

    await myUplinkClient.getAllParameters()
    
    // console.log(data)
    // console.log('3initState',myUplinkClient.initState)
  } catch (error) {
    console.error('myUplink config error: ' + error.message || error)
  }
  process.exit()
}
startTest()
