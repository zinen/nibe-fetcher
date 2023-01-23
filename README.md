# nibe-fetcher-promise

This is a fork of [nibe-fetcher](https://github.com/z0mt3c/nibe-fetcher). 

This fork aims for zero dependencies(node native modules) and promise based to work with NIBE uplink API v1. 

Zero dependencies so I don't have to update this module every so often and promise based as I like JS async/await way of coding.

Install
```
npm install nibe-fetcher-promise
```
## Functions:
More info about what the calls new to contain can be found here. https://api.nibeuplink.com/docs/v1/Functions

### getURLPath(path,queryParameters)
*Generic GET request containing authorization*

Required: path

Optional: queryParameters

E.g. for systemID 54654:

``getURLPath(`/api/v1/systems/{systemId}/serviceinfo/categories`,{systemId:54654, systemUnitId: 0, parameters:true})``

Returns a Promise
### putURLPath(path,queryParameters,body={})
**This PUT function has not been tested successful yet but should in theory work**

*Generic PUT request containing authorization*

Required: path

Optional: queryParameters, body

E.g. for systemID 54654 telling outside temperature is 23°C:

``putURLPath(`api/v1/systems/54654/parameters`,{systemId:54654},{settings: {40067: 230}})``

Returns a Promise

# Examples
To help with an easy start
## Example 1

Log into [api.nibeuplink.com](https://api.nibeuplink.com/). Create an application with callback URL = `http://z0mt3c.github.io/nibe.html`. Note the Identifier aka. clientId and the Secret aka clientSecret as input parameters when creating this class.

If you have multiple systems connected you must find the systemId via `await nibeuplinkClient.getSystems()` as shown below. If you only have one this will be automatically chosen.
```js
const NibeuplinkClient = require('nibe-fetcher-promise')
const fs = require('node:fs/promises')
const Path = require('path')

const myOptions = {
  clientId: 'TnQN5WAykGeTuVX1VQxmLd', // aka Identifier from  api.nibeuplink.com
  clientSecret: 'V6VATXbJr0eX0fqph5BAjt', // aka Secret from  api.nibeuplink.com,
  authCode: '', // authCode should be empty at first run
  // systemId: 123152 // OPTIONAL if you only have one system ignore this setting
  //debug: 0 // DEFAULT = 0, increase to 3 for most verbose console.logs
}
const nibeuplinkClient = new NibeuplinkClient(myOptions)
async function start() {
  try {
    const systemsData = await nibeuplinkClient.getSystems()
    console.log(systemsData)
    // Returns: {..., objects: [each of your systems]}
    const allParameters = await nibeuplinkClient.getAllParameters()
    // console.log(allParameters)
    // Returns: {parameter_key:{... values }}
    fs.writeFile(Path.join(__dirname, './.parameters.json'), JSON.stringify(allParameters, null, 2))

  } catch (error) {
    if (error.message.includes('Need new authCode.')) {
      // Normal to hit this on first request or when session expires
      console.log(error.message)
    } else {
      console.trace(error)
    }
  }
}
start()
```
