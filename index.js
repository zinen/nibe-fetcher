'use strict'
const https = require('node:https')
const querystring = require('node:querystring')
const Path = require('node:path')
const fs = require('node:fs/promises')

class MyUplinkClient {
  #auth = undefined
  #init = false
  requestQueueActive = false
  requestQueue = 0

  #requestOptions = {
    hostname: 'api.myuplink.com',
    port: 443,
    rejectUnauthorized: true,
    headers: { 'Content-Type': 'application/json;charset=UTF-8' },
    path: undefined,
    method: undefined
  }

  // Define default options
  options = {
    authCode: undefined,
    debug: 0,
    clientId: null,
    clientSecret: null,
    redirectUri: 'http://z0mt3c.github.io/nibe.html',
    scope: 'READSYSTEM offline_access',
    sessionStore: Path.join(__dirname, './.session.json'),
    systemId: null,
    deviceId: null
  }

  constructor (options) {
    // Merge default options above with the ones applied at when constructing the class
    this.options = {
      ...this.options,
      ...options
    }
    let faultText = ''
    if (!this.options.clientId) faultText += 'clientId is missing from options. Add clientId to continue. '
    if (!this.options.clientSecret) faultText += 'clientSecret is missing from options. Add clientSecret to continue. '
    if (this.options.systemId && typeof this.options.systemId === 'string' && this.options.systemId.length < 16) faultText += 'systemId must be a string longer then 16 characters. '
    if (this.options.deviceId && typeof this.options.deviceId === 'string' && this.options.deviceId.length < 16) faultText += 'deviceId must be a string longer then 16 characters. '
    if (this.options.authCode && this.options.authCode.length < 60) faultText += 'authCode seems too short. Try a new authCode. '
    if (faultText.length > 0) throw new Error(faultText)
  }

  promiseTimeout (delay) {
    if (this.options.debug > 2) console.log('promiseTimeout called waiting for', delay, 'ms, waiting requests:', this.requestQueue)
    return new Promise(resolve => setTimeout(resolve, delay))
  }

  async readSession () {
    try {
      if (this.options.debug > 2) console.log('readSession of file', this.options.sessionStore)
      const fileContent = await fs.readFile(this.options.sessionStore, { encoding: 'utf8' }) || '{}'
      if (this.options.debug > 2) console.log('readSession file content', fileContent)
      try {
        this.#auth = JSON.parse(fileContent)
      } catch (error) {
        console.error('Error during JSON parsing of reading session data from', this.options.sessionStore)
        console.error(error)
        return
      }
      return this.#auth
    } catch { }
  }

  async getSession (key) {
    if (!this.#auth) await this.readSession()
    if (key) return this.#auth && this.#auth[key] ? this.#auth[key] : null
    return this.#auth
  }

  async setSession (auth) {
    this.#auth = auth
    if (!this.options.sessionStore || !auth.access_token) {
      if (this.options.debug > 3) console.log(`setSession called but not saved to disk, missing access_token. Content: ${JSON.stringify(auth)}`)
      return
    }
    if (this.options.scope.includes('offline_access') && auth.scope && !auth.scope.includes('offline_access')) {
      console.error('myUplink setSession content should have contained a string of offline_access but was not found. Remember to check offline access after login to myuplink')
    }
    fs.writeFile(this.options.sessionStore, JSON.stringify(auth))
  }

  async clearSession (saveToDisk = true) {
    this.#auth = undefined
    this.#init = false
    if (saveToDisk) fs.writeFile(this.options.sessionStore, '{}')
  }

  async requestQueueing (event) {
    if (event === 'end') {
      this.requestQueueActive = false
      return
    } else if (event === 'wait') {
      this.requestQueue++
    } else {
      throw new Error(`Error in requestQueueing handling. event=${event} should be wait or end`)
    }
    while (this.requestQueueActive && new Date().getTime() < this.requestQueueTimeout) {
      if (this.options.debug) console.log(`Queue: ${this.requestQueueActive ? 'active' : 'non-active'}, in queue: ${this.requestQueue}`)
      await this.promiseTimeout(250)
    }
    this.requestQueueTimeout = new Date().getTime() + 7000
    this.requestQueue--
    this.requestQueueActive = true
  }

  getNewAccessToken () {
    const self = this
    // eslint-disable-next-line no-async-promise-executor
    return new Promise(async function (resolve, reject) {
      const queryAccessToken = {
        grant_type: 'authorization_code',
        client_id: self.options.clientId,
        client_secret: self.options.clientSecret,
        code: self.options.authCode,
        redirect_uri: self.options.redirectUri,
        scope: self.options.scope
      }
      const postData = querystring.stringify(queryAccessToken)
      const requestOptions = { ...self.#requestOptions }
      requestOptions.headers = {
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8'
      }
      requestOptions.path = '/oauth/token'
      requestOptions.method = 'POST'
      await self.requestQueueing('wait')
      const request = https.request(requestOptions, res => {
        let rawData = ''
        res.on('data', chunk => {
          rawData += chunk
        })
        res.on('end', () => {
          self.requestQueueing('end')
          // Incoming:
          // {
          //   "access_token":[ACCESS_TOKEN],
          //   "expires_in":300,
          //   "refresh_token":[REFRESH_TOKEN],
          //   "scope":[SCOPES],
          //   "token_type":"bearer"
          // }
          if (res.statusCode !== 200) {
            if (self.options.debug > 1) console.log('getNewAccessToken response:', rawData)
            reject(new Error('Error in response from API. The one time use of authCode might be used already'))
          }
          let response
          try {
            response = JSON.parse(rawData)
          } catch (_) {
            reject(rawData)
          }
          if (response.error) {
            reject(new Error('Error in response from API. The one time use of authCode might be used already'))
          }
          response.timestamp = new Date().toISOString()
          if (response.expires_in) {
            response.expires_at = new Date().setSeconds(new Date().getSeconds() + response.expires_in - 5)
          }
          self.setSession(response)
          resolve(response)
        })
      }).on('error', err => {
        self.requestQueueing('end')
        reject(err)
      })
      request.end(postData)
    })
  }

  refreshAccessToken () {
    const self = this
    // eslint-disable-next-line no-async-promise-executor
    return new Promise(async function (resolve, reject) {
      const queryRefreshToken = {
        grant_type: 'refresh_token',
        client_id: self.options.clientId,
        client_secret: self.options.clientSecret,
        refresh_token: await self.getSession('refresh_token')
      }
      const postData = querystring.stringify(queryRefreshToken)
      const requestOptions = { ...self.#requestOptions }
      requestOptions.headers = {
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8'
      }
      requestOptions.path = '/oauth/token'
      requestOptions.method = 'POST'

      await self.requestQueueing('wait')
      const request = https.request(requestOptions, res => {
        let rawData = ''
        res.on('data', chunk => {
          rawData += chunk
        })
        res.on('end', () => {
          self.requestQueueing('end')
          // Incoming:
          // {
          //   "access_token":[ACCESS_TOKEN],
          //   "expires_in":300,
          //   "refresh_token":[REFRESH_TOKEN],
          // }
          let response
          try {
            response = JSON.parse(rawData)
          } catch (_) { }
          // If response does not have status code 2xx
          if (res.statusCode >= 300 || res.statusCode < 200) {
            if (self.options.debug > 1) console.log('refreshAccessToken response:', rawData)
            if (response && response.error) {
              reject(new Error(`Error in response from API. Refresh token might have expired. API Error message: ${String(response.error)}`))
            }
            reject(new Error('Error in response from API. Refresh token might have expired.'))
          }
          response.timestamp = new Date().toISOString()
          if (response.expires_in) {
            response.expires_at = new Date().setSeconds(new Date().getSeconds() + response.expires_in - 5)
          }
          self.setSession(response)
          resolve(response)
        })
      }).on('error', err => {
        self.requestQueueing('end')
        reject(err)
      })
      request.end(postData)
    })
  }

  async #requestAPI (method, path, body) {
    if (path[0] !== '/') { path = '/' + path }
    const self = this
    // eslint-disable-next-line no-async-promise-executor
    return new Promise(async function (resolve, reject) {
      const requestOptions = { ...self.#requestOptions }
      requestOptions.headers.Authorization = `Bearer ${await self.getSession('access_token')}`
      requestOptions.path = path
      requestOptions.method = method

      await self.requestQueueing('wait')
      const request = https.request(requestOptions, res => {
        let rawData = ''
        res.on('data', chunk => {
          rawData += chunk
        })
        res.on('end', () => {
          self.requestQueueing('end')
          if (res.statusCode >= 300) {
            if (self.options.debug > 1) console.log('requestAPI response:', rawData)
            let errorDetails = ''
            try {
              errorDetails = ' ' + JSON.parse(rawData).details[0]
            } catch (_) { }
            const errorText = 'Access token might have expired'
            if (res.statusCode === 400) {
              reject(new Error('Request content from client not accepted by server.' + errorDetails))
            } else if (res.statusCode === 401) {
              reject(new Error('Unauthorized.' + errorDetails))
            } else if (res.statusCode === 403) {
              reject(new Error('Not authorized for action.' + errorDetails))
            } else if (res.statusCode === 404) {
              reject(new Error('Requested parameter not found.' + errorDetails))
            }
            reject(new Error(`${res.statusCode} Error in response from API url inputPath ${path}. ${errorDetails || errorText}`))
          }
          try {
            rawData = JSON.parse(rawData)
          } catch (_) { }
          resolve(rawData)
        })
      }).on('error', err => {
        self.requestQueueing('end')
        reject(err)
      })
      request.end(body)
    })
  }

  async getURLPath (inputPath, queryParameters = null, skipInitCheck = false) {
    if (!skipInitCheck && (!this.#init || new Date() > new Date(await this.getSession('expires_at')))) await this.init()
    if (queryParameters) {
      inputPath += '?' + querystring.stringify(queryParameters)
    }
    if (this.options.debug) console.log('GET ' + inputPath)
    return this.#requestAPI('GET', inputPath)
  }

  async getSystems (skipInitCheck = false, failOnEmpty = false) {
    let payload = await this.getURLPath('/v2/systems/me?page=1&itemsPerPage=100', null, skipInitCheck)
    if (payload.systems && payload.systems.length > 0) {
      // if systemId is not defined. Choose the first item as the systemId
      if (!this.options.systemId) this.options.systemId = payload.systems[0].systemId
      if (!this.options.deviceId && payload.systems[0].devices && payload.systems[0].devices.length) {
        // if deviceId is not defined. Choose the first item matching the systemId as the deviceId
        this.options.deviceId = payload.systems.find(item => item.systemId === this.options.systemId).devices[0].id
      }
    }
    if (failOnEmpty && (!this.options.systemId || !this.options.deviceId)) {
      if (typeof payload === 'object') {
        delete payload.page
        delete payload.itemsPerPage
        delete payload.numItems
        payload = JSON.stringify(payload)
      }
      throw new Error(`myUplink retrieval of systemId and deviceId failed. Empty list of systems returned. Payload: ${payload}`)
    }
    return payload
  }

  // NOT tested with myUplink API
  async getAllParameters () {
    if (!this.options.deviceId) await this.getSystems(undefined, true)
    const payload = await this.getURLPath(`/v3/devices/${this.options.deviceId}/points`)
    const data = {}
    payload.forEach(parameter => {
      let key = parameter.parameterName.replace(/\.|,|\(|\)|:/g, '').replace(/\s/g, '_').toLowerCase()
      // Fix for the parameterNames that contains weird unicode characters
      // eslint-disable-next-line no-control-regex
      key = key.replace(/[^\x00-\x7f]/g, '')
      data[key] = parameter
    })
    return data
  }

  async putURLPath (inputPath, body = {}, skipInitCheck = false) {
    if (!skipInitCheck && (!this.#init || new Date() > new Date(await this.getSession('expires_at')))) await this.init()
    if (this.options.debug) {
      console.log('PUT ' + inputPath)
      console.log('PUT BODY ' + JSON.stringify(body))
    }
    return this.#requestAPI('PUT', inputPath, JSON.stringify(body))
  }

  async postURLPath (inputPath, body = {}, skipInitCheck = false) {
    if (!skipInitCheck && (!this.#init || new Date() > new Date(await this.getSession('expires_at')))) await this.init()
    if (this.options.debug) {
      console.log('POST ' + inputPath)
      console.log('POST BODY ' + JSON.stringify(body))
    }
    return this.#requestAPI('POST', inputPath, JSON.stringify(body))
  }

  async patchURLPath (inputPath, body = {}, skipInitCheck = false) {
    if (!skipInitCheck && (!this.#init || new Date() > new Date(await this.getSession('expires_at')))) await this.init()
    if (this.options.debug) {
      console.log('PATCH ' + inputPath)
      console.log('PATCH BODY ' + JSON.stringify(body))
    }
    return this.#requestAPI('PATCH', inputPath, JSON.stringify(body))
  }

  initState = (inText) => {
    if (this.options.debug) console.log('init: ' + inText)
    this.lastInitState = inText
  }

  init = async () => {
    if (this.#init && new Date() <= new Date(this.getSession('expires_at'))) return
    this.requestQueueActive = false
    this.requestQueue = 0
    this.#init = true
    this.initState('starting')
    if (await this.getSession('access_token') && await this.getSession('expires_at')) {
      this.initState('access_token found')
      if (new Date() > new Date(await this.getSession('expires_at'))) {
        this.initState('access_token token must be refreshed, trying now')
        try {
          await this.refreshAccessToken()
          await this.getSystems(true)
          this.initState('access_token is now refreshed')
          return true
        } catch (error) {
          this.initState('access_token expired and failed at refresh')
        }
      } else {
        try {
          await this.getSystems(true)
          this.initState('access_token has not expired yet')
          return true
        } catch (error) {
          this.initState('access_token failed even though it should not be expired yet')
          if (String(error) !== 'Error: Unauthorized.') console.trace(error)
        }
        if (await this.getSession('refresh_token')) {
          try {
            await this.refreshAccessToken()
            await this.getSystems(true)
            this.initState('access_token is now refreshed before it should have expired')
            return true
          } catch (error) {
            if (this.options.debug > 4) console.log(error)
            this.initState('access_token refreshed failed. Stored session data might have errors. Resetting session internally')
            await this.clearSession(false)
          }
        }
      }
    }
    if (this.options.authCode) {
      try {
        await this.getNewAccessToken()
        this.initState('one time use authCode now exchanged for new access_token')
        try {
          await this.getSystems(true)
          this.initState('testing new access_token returned success')
          return true
        } catch (error) {
          this.initState('testing new access_token failed')
          console.trace(error)
        }
      } catch (error) {
        if (this.options.debug > 4) console.trace(error)
        this.initState('one time use authCode might have been used already')
      }
    }
    this.initState('request new authCode')
    const queryAuth = {
      response_type: 'code',
      client_id: this.options.clientId,
      scope: this.options.scope,
      redirect_uri: this.options.redirectUri,
      state: 'x'
    }
    const urlAuth = 'https://' + this.#requestOptions.hostname + ':' + this.#requestOptions.port + '/oauth/authorize?' + querystring.stringify(queryAuth)
    throw new Error(`Need new authCode. Go to page ${urlAuth}`)
  }

  /**
   * Used for test to redefine API url
   * @param {string} testUrl hostname:port
   * @returns {string} URL string
   */
  _setAPIUrl = (testUrl) => {
    const spilt = testUrl.split(':')
    this.#requestOptions.hostname = spilt[0]
    if (spilt[1] && !isNaN(spilt[1]) && spilt[1] > 0 && spilt[1] < 65535) {
      this.#requestOptions.port = spilt[1]
    }
    this.#requestOptions.rejectUnauthorized = false // Ignore self-signed certificates
    return this.#requestOptions.hostname + ':' + this.#requestOptions.port
  }
}
module.exports = MyUplinkClient
