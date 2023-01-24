"use strict";
const https = require('https');
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
  }
  promiseTimeout(delay){
    if (this.options.debug) console.log('promiseTimeout called waiting for', delay, 'ms, waiting requests:', this.requestQueue)
    return new Promise(resolve => setTimeout(resolve, delay));
  }

  async readSession() {
    try {
      const fileContent = await fs.readFile(this.options.sessionStore, { encoding: 'utf8' }) || "{}"
      this.#auth = JSON.parse(fileContent)
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

  requestQueueing(changeInt, changeBool) {
    if (changeInt != null) this.requestQueue += changeInt
    if (changeBool != undefined) this.requestQueueActive = changeBool
    if (this.options.debug) console.log(`Queue: ${this.requestQueueActive ? 'active' : 'non-active'}, in queue: ${this.requestQueue}`)
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
      self.requestQueueing(1)
      while (self.requestQueueActive) {
        await self.promiseTimeout(250)
      }
      self.requestQueueing(null, true)
      const request = https.request(requestOptions, res => {
        let rawData = '';
        if (res.statusCode != 200) {
          reject('Error in response from API. The one time use of authCode might be used already')
        }
        res.on('data', chunk => {
          rawData += chunk
        });
        res.on('end', () => {
          self.requestQueueing(-1, false)
          // Incoming:
          // {
          //   "access_token":[ACCESS_TOKEN],
          //   "expires_in":300,
          //   "refresh_token":[REFRESH_TOKEN],
          //   "scope":[SCOPES],
          //   "token_type":"bearer"
          // }
          const response = JSON.parse(rawData);
          if (response.error) {
            return reject('Error in response from API. The one time use of authCode might be used already')
          }
          response.timestamp = new Date().toISOString()
          if (response.expires_in) {
            response.expires_at = new Date().setSeconds(new Date().getSeconds() + response.expires_in - 5)
          }
          self.setSession(response)
          resolve(response)
        });
      }).on('error', err => {
        self.requestQueueing(-1, false)
        reject(err)
      });
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
      self.requestQueueing(1)
      while (self.requestQueueActive) {
        await self.promiseTimeout(250)
      }
      self.requestQueueing(null, true)
      const request = https.request(requestOptions, res => {
        let rawData = '';
        if (res.statusCode != 200) {
          reject('Error in response from API. The one time use of authCode might be used already')
        }
        res.on('data', chunk => {
          rawData += chunk
        });
        res.on('end', () => {
          self.requestQueueing(-1, false)
          // Incoming:
          // {
          //   "access_token":[ACCESS_TOKEN],
          //   "expires_in":300,
          //   "refresh_token":[REFRESH_TOKEN],
          // }
          const response = JSON.parse(rawData);
          if (response.error) {
            return reject('Error in response from API. The one time use of authCode might be used already')
          }
          response.timestamp = new Date().toISOString()
          if (response.expires_in) {
            response.expires_at = new Date().setSeconds(new Date().getSeconds() + response.expires_in - 5)
          }
          self.setSession(response)
          resolve(response)
        });
      }).on('error', err => {
        self.requestQueueing(-1, false)
        reject(err)
      });
      request.end(postData)
    })
  }

  async getURLPath(inputPath, queryParameters, skipInitCheck=false) {
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
      self.requestQueueing(1)
      while (self.requestQueueActive) {
        await self.promiseTimeout(250)
      }
      self.requestQueueing(null, true)
      const request = https.request(requestOptions, res => {
        let rawData = '';
        if (res.statusCode != 200) {
          let errorText = 'Access token might have expired'
          if (res.statusCode == 401) {
            reject('Unauthorized')
          } else if (res.statusCode == 404) {
            errorText = 'Requested parameter not found'
          }
          reject(`${res.statusCode} Error in response from API url inputPath ${inputPath}. ${errorText}`)
        }
        res.on('data', chunk => {
          rawData += chunk
        });
        res.on('end', () => {
          self.requestQueueing(-1, false)
          resolve(JSON.parse(rawData))
        });
      }).on('error', err => {
        self.requestQueueing(-1, false)
        reject(err)
      });
      request.end()
    })
  }

  async getSystems(skipInitCheck=false) {
    const payload = await this.getURLPath('/api/v1/systems',null, skipInitCheck)
    if (!this.options.systemId) this.options.systemId = payload.objects[0].systemId
    return payload
  }
  async getAllParameters() {
    const payload = await this.getURLPath(`api/v1/systems/${this.options.systemId}/serviceinfo/categories`,{systemId:this.options.systemId, systemUnitId: 0, parameters:true})
    const data = {}
    payload.forEach(element => {
      const category = element.categoryId
      element.parameters.forEach(parameter => {
        const key = (category + ' ' + parameter.title).replace(/\.|,|\(|\)/g,'').replace(/\s/g,'_').toLowerCase()
        delete parameter.title
        delete parameter.name
        if (parameter.unit.length) parameter.value = parseFloat(parameter.displayValue.slice(0, -parameter.unit.length))
        data[key] = parameter
      })
    })
    return data
  }

  async putURLPath(inputPath, queryParameters, body = {}, skipInitCheck=false) {
    if (!skipInitCheck && (!this.#init || new Date() > new Date(await this.getSession('expires_at')))) await this.init()
    if (!this.#init || new Date() > new Date(await this.getSession('expires_at'))) await this.init()
    if (inputPath[0] != '/') { inputPath = '/' + inputPath }
    const queryString = querystring.stringify(queryParameters)
    const pathRequest = inputPath + '?' + queryString
    if (this.options.debug) console.log('PUT ' + pathRequest)
    if (this.options.debug) console.log('PUT BODY ' + JSON.stringify(body))
    const self = this
    return new Promise(async function (resolve, reject) {
      const requestOptions = {
        headers: {
          Authorization: `Bearer ${await self.getSession('access_token')
            }`
        },
        hostname: self.options.baseUrl,
        path: pathRequest,
        method: 'PUT',
        headers: {
          "Content-Type": "application/json"
        }
      }
      self.requestQueueing(1)
      while (self.requestQueueActive) {
        await self.promiseTimeout(250)
      }
      self.requestQueueing(null, true)
      const request = https.request(requestOptions, res => {
        let rawData = '';
        if (res.statusCode != 200) {
          let errorText = 'Access token might have expired'
          if (res.statusCode == '404') {
            errorText = 'Requested parameter not found'
          } else if (res.statusCode == '403') {
            errorText = 'No authorized for action'
          }
          reject(`${res.statusCode} Error in response from API url inputPath ${inputPath}. ${errorText}`)
        }
        res.on('data', chunk => {
          rawData += chunk
        });
        res.on('end', () => {
          self.requestQueueing(-1, false)
          resolve(JSON.parse(rawData))
        });
      }).on('error', err => {
        self.requestQueueing(-1, false)
        reject(err)
      });
      request.end(JSON.stringify(body))
    })
  }

  initState = (inText) => {
    if (this.options.debug) console.log('init: ' + inText)
    this.lastInitState = inText
  }

  init = async () => {
    if (this.#init && new Date() <= new Date(this.getSession('expires_at'))) return
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
