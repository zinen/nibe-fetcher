# nibe-fetcher-promise
[![Platform](https://img.shields.io/badge/platform-Node--RED-red)](https://nodered.org)
[![NPM Total Downloads](https://img.shields.io/npm/dt/nibe-fetcher-promise.svg)](https://www.npmjs.com/package/nibe-fetcher-promise)

This is a fork of [nibe-fetcher](https://github.com/z0mt3c/nibe-fetcher) by [z0mt3c](https://github.com/z0mt3c). 

This fork aims for zero dependencies(node native modules) and promise based to work with NIBE uplink API v1. 

Zero dependencies so I don't have to update this module every so often and promise based as I like JS async/await way of coding.

Install
```
npm install nibe-fetcher-promise
```
## Functions
More info about what the calls new to contain can be found here. https://api.myuplink.com/swagger/index.html

### new in class

```js
const UplinkClient = require('nibe-fetcher-promise')
const uplinkClient = new UplinkClient({
  clientId:'asdasdasda', // Get this at https://dev.myuplink.com/apps
  clientSecret:'adasdasd123!!xasd', // Get this at https://dev.myuplink.com/apps
  authCode:'blblablabla', // Leave empty at first run and replace with content after browsing link from console output URL
  sessionStore: Path.join(__dirname, './.session.json'), // Default session data stored in a file at the modules root dir
  scope: 'READSYSTEM offline_access', // Default=READSYSTEM or can be 'READSYSTEM WRITESYSTEM'. Note 'offline_access' was implemented in APIv2 and means that the access code wont die after an hour. 
  systemId: 123152 // OPTIONAL if you only have one system ignore this setting. Or for multiple systems get yours via function getSystems()
  //debug: 0, // Must be a number from 0=off to 3=most console.logs
  //redirectUri: 'http://z0mt3c.github.io/nibe.html', // The Oauth return URL. Pr default links to z0mt3c page that just make the authCode ready for an easy copy/paste for you.
  sessionStore: Path.join(__dirname, './.session.json') // Were to store the session details. 
})

```

### clearSession()
*Continuously resource problems? Try clearing the stored session details from storage*

`uplinkClient.clearSession()`

Returns nothing
### getSystems()
*Gets you list of systems connected to your user*

Returns a Promise. Resolving to `{..., objects: [each of your systems]}`

### getAllParameters()
*Gets you all parameters that can be retrieved for your system*

Returns a Promise. Resolving to `{parameter_key:{... values },parameter_key...}`

### getURLPath(path,queryParameters)
*Generic GET request containing authorization*

Required: path

Optional: queryParameters

E.g. for systemID 54654:

``uplinkClient.getURLPath(`/api/v1/systems/54654/serviceinfo/categories`,{parameters:true})``

Returns a Promise. Resolving to an object containing the response.
### putURLPath(path,body={})
**This PUT function will require you to have a premium subscription to be allowed work else an error code 404 is thrown**

*Generic PUT request containing authorization*

Required: path, body

E.g. for systemID 54654 telling outside temperature is 15°C:

``uplinkClient.putURLPath(`api/v1/systems/54654/parameters`,{settings: {40067: 150}})``

Returns a Promise. Resolving to an object containing the response.

### postURLPath(path,body={})

*Generic POST request containing authorization*

Required: path, body

E.g. for systemID 54654 making a virtual temperature probe at 22°C:

``uplinkClient.postURLPath(`api/v1/systems/54654/parameters`,{externalId:1,"name":"virtualProbe","actualTemp":220})``

Returns a Promise. Resolving to an object containing the response.

# Examples
To help with an easy start
## Example 1

Log into https://dev.myuplink.com/apps . Create an application with callback URL = `http://z0mt3c.github.io/nibe.html`. Note the Identifier aka. clientId and the Secret aka clientSecret as input parameters when creating this class.

If you have multiple systems connected you must find the systemId via `await uplinkClient.getSystems()` as shown below. If you only have one this will be automatically chosen.
```js
const UplinkClient = require('nibe-fetcher-promise')
const fs = require('node:fs/promises')
const Path = require('path')

const myOptions = {
  clientId: 'TnQN5WAykGeTuVX1VQxmLd', // aka Identifier from  https://dev.myuplink.com/apps
  clientSecret: 'V6VATXbJr0eX0fqph5BAjt', // aka Secret from  https://dev.myuplink.com/apps,
  authCode: '', // authCode should be empty at first run
  // systemId: 123152 // OPTIONAL if you only have one system ignore this setting
  //debug: 0 // DEFAULT = 0, increase to 3 for most verbose console.logs
}
const uplinkClient = new UplinkClient(myOptions)
async function start() {
  try {
    const systemsData = await uplinkClient.getSystems()
    console.log(systemsData)
    // Returns: {..., objects: [each of your systems]}
    const allParameters = await uplinkClient.getAllParameters()
    // console.log(allParameters)
    // Returns: {parameter_key:{... values },parameter_key...}
    fs.writeFile(Path.join(__dirname, './.parameters.json'), JSON.stringify(allParameters, null, 2))
    // Pretty prints all parameters to a file at module root

  } catch (error) {
    if (error.message && error.message.includes('Need new authCode.')) {
      // Normal to hit this on first request or when session expires
      console.log(error.message)
    } else {
      console.trace(error)
    }
  }
}
start()
```

## Limits

The API specifies to do only one request pr 4 second but allowing some burst(undefined precisely what this means). Implement this your own way when using this module.

As a default the session data is stored in the directory of this module and only one session is stored(The newest one). Change options `sessionStore` to fix this and remember to clean up orphaned files after changing `sessionStore` options.

This module has not implemented a way of handling pagination. Pagination is however part of the API spec. But I haven't found any usage for it.
