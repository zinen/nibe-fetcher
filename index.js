"use strict";
const https = require('https')
const querystring = require('querystring')
const Path = require('path')
const fs = require('node:fs/promises')

class NibeuplinkClient {
  #auth = undefined
  #init = false
  requestQueueActive = false
  requestQueue = 0

  // Define default options
  options = {
    debug: 0,
    clientId: null,
    clientSecret: null,
    systemId: null,
    baseUrl: 'api.nibeuplink.com',
    redirectUri: 'http://z0mt3c.github.io/nibe.html',
    scope: 'READSYSTEM',
    sessionStore: Path.join(__dirname, './.session.json')
  }
  constructor(options) {
    // Merge default options above with the ones applied at when constructing the class
    this.options = {
      ...this.options,
      ...options
    }
    let faultText = ''
    if (!this.options.clientId) faultText += 'clientId is missing from options. Add clientId to continue. '
    if (!this.options.clientSecret) faultText += 'clientSecret is missing from options. Add clientSecret to continue. '
    if (this.options.systemId && isNaN(Number(this.options.systemId))) faultText += 'systemId must be a number. Replace systemId with a number. '
    if (this.options.authCode && this.options.authCode.length < 380) faultText += 'authCode seems too short. Try a new authCode. '
    if (faultText.length > 0) throw new Error(faultText)
  }
  promiseTimeout(delay) {
    if (this.options.debug > 2) console.log('promiseTimeout called waiting for', delay, 'ms, waiting requests:', this.requestQueue)
    return new Promise(resolve => setTimeout(resolve, delay))
  }

  async readSession() {
    try {
      const fileContent = await fs.readFile(this.options.sessionStore, { encoding: 'utf8' }) || "{}"
      try {
        this.#auth = JSON.parse(fileContent)
      } catch (error) {
        console.error('Error during JSON parsing of reading session data from', this.options.sessionStore)
        console.error(err)
        return
      }
      return this.#auth
    } catch (error) {
      return
    }
  }

  async getSession(key) {
    if (!this.#auth) await this.readSession()
    if (key) return this.#auth && this.#auth[key] ? this.#auth[key] : null
    return this.#auth
  }

  async setSession(auth) {
    this.#auth = auth
    if (!this.options.sessionStore) return
    fs.writeFile(this.options.sessionStore, JSON.stringify(auth))
  }

  async clearSession() {
    this.#auth = undefined
    this.#init = false
    fs.writeFile(this.options.sessionStore, "{}")
  }

  async requestQueueing(event) {
    if (event == 'end') {
      this.requestQueueActive = false
      return
    } else if (event == 'wait') {
      this.requestQueue++
    } else {
      throw new Error(`Error in requestQueueing handling. event=${event} should be wait or end`)
    }
    while (this.requestQueueActive) {
      if (this.options.debug) console.log(`Queue: ${this.requestQueueActive ? 'active' : 'non-active'}, in queue: ${this.requestQueue}`)
      await this.promiseTimeout(250)
    }
    this.requestQueue--
    this.requestQueueActive = true
  }

  getNewAccessToken() {
    const self = this
    return new Promise(async function (resolve, reject) {
      const queryAccessToken = {
        grant_type: 'authorization_code',
        client_id: self.options.clientId,
        client_secret: self.options.clientSecret,
        code: self.options.authCode,
        redirect_uri: self.options.redirectUri,
        scope: self.options.scope,
      }
      const postData = querystring.stringify(queryAccessToken)
      const requestOptions = {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
        },
        hostname: self.options.baseUrl,
        path: '/oauth/token',
        method: 'POST',
      }
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
          if (res.statusCode != 200) {
            if (self.options.debug > 1) console.log('getNewAccessTokenX response:', rawData)
            reject('Error in response from API. The one time use of authCode might be used already')
          }
          let response
          try {
            response = JSON.parse(rawData)
          } catch (_) {
            reject(rawData)
          }
          if (response.error) {
            reject('Error in response from API. The one time use of authCode might be used already')
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

  refreshAccessToken() {
    const self = this
    return new Promise(async function (resolve, reject) {
      const queryRefreshToken = {
        grant_type: 'refresh_token',
        client_id: self.options.clientId,
        client_secret: self.options.clientSecret,
        refresh_token: await self.getSession('refresh_token')
      }
      const postData = querystring.stringify(queryRefreshToken)
      const requestOptions = {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
        },
        hostname: self.options.baseUrl,
        path: '/oauth/token',
        method: 'POST',
      }
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
          if (res.statusCode != 200) {
            if (self.options.debug > 1) console.log('refreshAccessTokenX response:', rawData)
            reject('Error in response from API. Refresh token might have expired.')
          }
          let response
          try {
            response = JSON.parse(rawData)
          } catch (_) {
            reject(response)
          }
          if (response.error) {
            reject('Error in response from API. Refresh token might have expired.')
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

  async getURLPath(inputPath, queryParameters, skipInitCheck = false) {
    if (!skipInitCheck && (!this.#init || new Date() > new Date(await this.getSession('expires_at')))) await this.init()
    if (inputPath[0] != '/') { inputPath = '/' + inputPath }
    if (queryParameters) {
      inputPath += '?' + querystring.stringify(queryParameters)
    }
    if (this.options.debug) console.log('GET ' + inputPath)
    const self = this
    return new Promise(async function (resolve, reject) {
      const requestOptions = {
        headers: {
          Authorization: `Bearer ${await self.getSession('access_token')
            }`
        },
        hostname: self.options.baseUrl,
        path: inputPath,
        method: 'GET',
      }
      await self.requestQueueing('wait')
      const request = https.request(requestOptions, res => {
        let rawData = ''
        res.on('data', chunk => {
          rawData += chunk
        })
        res.on('end', () => {
          self.requestQueueing('end')
          if (res.statusCode != 200) {
            if (self.options.debug > 1) console.log('getURLPathX response:', rawData)
            let errorText = 'Access token might have expired'
            if (res.statusCode == 400) {
              reject('Request content from client not accepted by server')
            } else if (res.statusCode == 401) {
              reject('Unauthorized')
            } else if (res.statusCode == 403) {
              reject('Not authorized for action')
            } else if (res.statusCode == 404) {
              reject('Requested parameter not found')
            }
            reject(`${res.statusCode} Error in response from API url inputPath ${inputPath}. ${errorText}`)
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
      request.end()
    })
  }

  async getSystems(skipInitCheck = false) {
    const payload = await this.getURLPath('/api/v1/systems', null, skipInitCheck)
    if (!this.options.systemId) this.options.systemId = payload.objects[0].systemId
    return payload
  }
  async getAllParameters() {
    const payload = await this.getURLPath(`api/v1/systems/${this.options.systemId}/serviceinfo/categories`, { parameters: true })
    const data = {}
    const PARAMETERS_TO_FIX = [40079, 40081, 40083]
    payload.forEach(element => {
      const category = element.categoryId
      element.parameters.forEach(parameter => {
        if (PARAMETERS_TO_FIX.includes(parameter.parameterId)) parameter.title += ' ' + parameter.designation
        const key = (category + ' ' + parameter.title).replace(/\.|,|\(|\)/g, '').replace(/\s/g, '_').toLowerCase()
        delete parameter.title
        delete parameter.name
        if (parameter.unit.length) { parameter.value = parseFloat(parameter.displayValue.slice(0, -parameter.unit.length)) }
        else if (parseFloat(parameter.displayValue)) { parameter.value = parseFloat(parameter.displayValue) }
        else { parameter.value = parameter.rawValue }
        data[key] = parameter
      })
    })
    return data
  }

  async putURLPath(inputPath, queryParameters, body = {}, skipInitCheck = false) {
    if (!skipInitCheck && (!this.#init || new Date() > new Date(await this.getSession('expires_at')))) await this.init()
    if (inputPath[0] != '/') { inputPath = '/' + inputPath }
    let pathRequest = inputPath
    if (queryParameters) {
      pathRequest += '?' + querystring.stringify(queryParameters)
    }
    if (this.options.debug) {
      console.log('PUT ' + pathRequest)
      console.log('PUT BODY ' + JSON.stringify(body))
    }
    const self = this
    return new Promise(async function (resolve, reject) {
      const requestOptions = {
        headers: {
          Authorization: `Bearer ${await self.getSession('access_token')}`
        },
        hostname: self.options.baseUrl,
        path: pathRequest,
        method: 'PUT',
        headers: {
          "Content-Type": "application/json;charset=UTF-8"
        }
      }
      await self.requestQueueing('wait')
      const request = https.request(requestOptions, res => {
        let rawData = ''
        res.on('data', chunk => {
          rawData += chunk
        })
        res.on('end', () => {
          self.requestQueueing('end')
          if (res.statusCode != 200) {
            if (self.options.debug > 1) console.log('putURLPathX response:', rawData)
            let errorText = 'Access token might have expired'
            if (res.statusCode == 400) {
              reject('Request content from client not accepted by server. Status code 400.')
            } else if (res.statusCode == 401) {
              reject('Unauthorized')
            } else if (res.statusCode == 403) {
              reject('Not authorized for action')
            } else if (res.statusCode == 404) {
              reject('Requested parameter not found')
            }
            reject(`${res.statusCode} Error in response from API url inputPath ${inputPath}. ${errorText}`)
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
      request.end(JSON.stringify(body))
    })
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
          if (error != 'Unauthorized') console.trace(error)
        }
        if (this.getSession('refresh_token')) {
          await this.refreshAccessToken()
          await this.getSystems(true)
          this.initState('access_token is now refreshed before it should have expired')
          return true
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
        this.initState('one time use authCode might have been used already')
      }
    }
    this.initState('request new authCode')
    const queryAuth = {
      response_type: 'code',
      client_id: this.options.clientId,
      scope: this.options.scope,
      redirect_uri: this.options.redirectUri,
      state: 'init'
    }
    const urlAuth = 'https://' + this.options.baseUrl + '/oauth/authorize?' + querystring.stringify(queryAuth)
    throw new Error(`Need new authCode. Go to page ${urlAuth}`)
  }
}
module.exports = NibeuplinkClient
