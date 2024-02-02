'use strict'
const https = require('https')
const querystring = require('querystring')
const Path = require('path')
const fs = require('node:fs/promises')

class NibeuplinkClient {
  #auth = undefined
  #baseUrl = 'api.nibeuplink.com'
  #init = false
  requestQueueActive = false
  requestQueue = 0

  // Define default options
  options = {
    authCode: undefined,
    debug: 0,
    clientId: null,
    clientSecret: null,
    redirectUri: 'http://z0mt3c.github.io/nibe.html',
    scope: 'READSYSTEM',
    sessionStore: Path.join(__dirname, './.session.json'),
    systemId: null
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
    if (this.options.systemId && isNaN(Number(this.options.systemId))) faultText += 'systemId must be a number. Replace systemId with a number. '
    if (this.options.authCode && this.options.authCode.length < 380) faultText += 'authCode seems too short. Try a new authCode. '
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
    } catch (error) {

    }
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
    fs.writeFile(this.options.sessionStore, JSON.stringify(auth))
  }

  async clearSession () {
    this.#auth = undefined
    this.#init = false
    fs.writeFile(this.options.sessionStore, '{}')
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
      const requestOptions = {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8'
        },
        hostname: self.#baseUrl,
        path: '/oauth/token',
        method: 'POST'
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
          'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8'
        },
        hostname: self.#baseUrl,
        path: '/oauth/token',
        method: 'POST'
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
          if (res.statusCode !== 200) {
            if (self.options.debug > 1) console.log('refreshAccessToken response:', rawData)
            reject(new Error('Error in response from API. Refresh token might have expired.'))
          }
          let response
          try {
            response = JSON.parse(rawData)
          } catch (_) {
            reject(response)
          }
          if (response.error) {
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
    return new Promise(async function (resolve, reject) {
      const requestOptions = {
        headers: {
          Authorization: `Bearer ${await self.getSession('access_token')
            }`,
          'Content-Type': 'application/json;charset=UTF-8'
        },
        hostname: self.#baseUrl,
        path,
        method
      }
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

  async getSystems (skipInitCheck = false) {
    const payload = await this.getURLPath('/api/v1/systems', null, skipInitCheck)
    if (!this.options.systemId) this.options.systemId = payload.objects[0].systemId
    return payload
  }

  async getAllParameters () {
    if (!this.options.systemId) await this.getSystems()
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
        if (parameter.unit.length) { parameter.value = parseFloat(parameter.displayValue.slice(0, -parameter.unit.length)) } else if (parseFloat(parameter.displayValue)) { parameter.value = parseFloat(parameter.displayValue) } else { parameter.value = parameter.rawValue }
        data[key] = parameter
      })
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
          if (error !== 'Unauthorized') console.trace(error)
        }
        if (await this.getSession('refresh_token')) {
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
    const urlAuth = 'https://' + this.#baseUrl + '/oauth/authorize?' + querystring.stringify(queryAuth)
    throw new Error(`Need new authCode. Go to page ${urlAuth}`)
  }
}
module.exports = NibeuplinkClient
