module.exports = Site

var route = require('./routes')
  , request = require('./request')
  , templates = require('./templates')
  , Schema = require('./schema')
  , cookie = require('./cookie')

var _BASE_URL = window.BASE_URL || null

if(_BASE_URL) {
  _BASE_URL = _BASE_URL.charAt(0) === '/' ? _BASE_URL.slice(1) : _BASE_URL
  _BASE_URL = _BASE_URL.charAt(_BASE_URL.length-1) === '/' ? _BASE_URL.slice(0, -1) : _BASE_URL
}

function Site() {
  this.root = null
  this._tplCache = {}
  this._auth = {}
  this._offsetURL = _BASE_URL
  this.go = null
}

plate.Template.Meta.registerPlugin('loader', function(name, ready) {
  return new plate.Template(templates[name] || '')
})

plate.Template.Meta.registerFilter('is_object', function(input) {
  return input+'' === '[object Object]'
})

plate.Template.Meta.registerFilter('is_array', function(input) {
  return Array.isArray(input)
})

plate.Template.Meta.registerFilter('date_portion', function(input) {
  return input.split('T')[0]
})

plate.Template.Meta.registerFilter('time_portion', function(input) {
  return input.split('T')[1]
})

var cons = Site
  , proto = cons.prototype

proto.init = function(body) {
  var self = this
    , current

  self.root = $(body)

  self.getRootURL(function(err, url) {
    $(':root').on('click', 'a', function(ev) {
      if(ev.target.host !== window.location.host)
        return

      var target = $(ev.target)

      if(target.is('[rel=logout]') || target.parents('a[rel=logout]').length) {
        for(var k in localStorage)
          delete localStorage[k]

        ev.preventDefault()
        window.location = '/'+self._offsetURL+'/'
        return
      }

      if(target.is('[rel]') || target.parents('a[rel]').length)
        return

      ev.preventDefault()

      window.history.pushState({}, {}, please_route(ev.target.pathname))

      self.root.addClass('loading')
    })

    window.onpopstate = function(ev) {
      please_route(window.location.pathname)
      self.root.addClass('loading')
    }

    please_route(window.location.pathname)

    self.go = function(path) {
      window.history.pushState({}, {}, please_route(path))
    }

    function please_route(path) {
      var first_bit = /^\/([^\/]+)\//g.exec(path)[1]

      self._offsetURL = self._offsetURL || first_bit

      path = path
        .replace(/^\/([^\/]+)\//g, '')

      fn = route(path)


      if(current) {
        $('body')
          .removeClass('view_'+current._name)

        current.exit && current.exit()
      }

      $('body')
        .addClass('view_'+fn._name)

      fn(self) 

      current = fn
     
      return '/'+self._offsetURL+'/'+(path ? path.replace(/\/?$/, '/') : '')
    }
  })
}

proto.render = function(name, context, ready) {
  var self = this

  context.site = self

  self.cachedTemplate(name).render(context, function(err, data) {
    self.root.html(data)
    self.root.removeClass('loading')

    ready(null, self.root)  
  })  
}

proto.cachedTemplate = function(name) {
  var tpl = this._tplCache[name]
  if(!templates[name])
    return null

  if(!tpl) {
    tpl = new plate.Template(templates[name] || '')
  }
  this._tplCache[name] = tpl
  return tpl
}

proto.getRootURL = function(ready) {
  var self = this
    , url = self.storage.get('rooturl')

  if(url) {
    return ready(null, url)
  }

  self.render('root_url_dialog.html', {}, function(err, el) {
    var form = el.find('form')
    
    form.submit(function(ev) {
      ev.preventDefault()
     
      var val = self._apiURL = form.find('[name=root_url]').val()

      console.log(val)
      self.storage.set('rooturl', val)
      self.storage.set('auth', btoa(form.find('[name=user]').val()+':'+form.find('[name=password]').val()))
      return ready(null, val)
    })
  })
}

proto.schema = function(name, ready) {
  var self = this
    , key = 'schema:'+name
    , schema = self.storage.get(key)
  
  if(schema) {
    return ready(null, new Schema(name, schema, self))
  }

  self.schemaAll(gotSchema)

  function gotSchema(err, data) {
    if(err) return ready(err)

    if(!data[name] || !data[name].schema) {
      return ready(new Error('schema was borked'))
    }

    request.get(data[name].schema, self.authHeader(), {}, function(err, schemaData) {
      if(err) {
        return ready(err)
      }

      schemaData.urls = data[name]

      self.storage.set(key, schemaData)
      return ready(null, new Schema(name, schemaData, self))
    })
  }
}

proto.schemaAll = function(ready) {
  var self = this
    , schema = self.storage.get('schema')

  if(schema)
    return ready(null, schema)

  request.get(self.apiURL(), self.authHeader(), {}, function(err, data) {
    if(err) return ready(err)

    self.storage.set('schema', data)

    return ready(null, data)
  })
}

proto.resourceInstance = 
proto.schemaResources = function(url, ready) {
  request.get(url, this.authHeader(), {}, ready)
}

proto.authHeader = function() {
  return {
    'Authorization': 'Basic '+this.storage.get('auth')
  , 'X-CSRFToken': cookie('csrftoken') 
  }
}

proto.apiURL = function() {
  return this._apiURL
}

proto.put = function(uri, data, ready) {
  request.put(uri, this.authHeader(), data, ready)
}

proto.post = function(uri, data, ready) {
  request.post(uri, this.authHeader(), data, ready)
}

proto.delete = function(uri, data, ready) {
  request.delete(uri, this.authHeader(), data, ready)
}


if(true) {
  proto.storage = {
    get: getStorage
  , set: setStorage
  }
} else {
  proto.storage = {
    get: getEphemeral
  , set: setEphemeral
  }
}

function getEphemeral(key) {
  return this[key]
}

function setEphemeral(key, val) {
  this[key] = val
}

function getStorage(key) {
  return JSON.parse(localStorage.getItem(key))
}

function setStorage(key, value) {
  localStorage.setItem(key, JSON.stringify(value))
}
