import redis

from django.conf import settings
from django.conf.urls import url

from tastypie.resources import Resource
from tastypie import fields
from tastypie.authorization import Authorization
from tastypie.authentication import Authentication
from tastypie.exceptions import NotFound

r = redis.StrictRedis.from_url(settings.REDIS_URL)


def make_slug(val, version="latest"):
    return "hydra:v1:redirects:%s:%s" % (version, val)


def remove_slug(val, version="latest"):
    return val.replace("hydra:v1:redirects:%s:" % version, "")


def save(slug, url, version="latest"):
    redis_slug = make_slug(slug, version)
    return r.zincrby(redis_slug, url, 1)
    #r.set(redis_slug, urls)


def get_range(pk, withscores=True):
    return r.zrange(make_slug(pk), 0, -1, withscores=withscores)


def get_keys(key):
    return r.keys(make_slug('%s' % key))


def delete(slug):
    return r.delete(make_slug(slug))


def get_urls(slug, count=None):
    ret_val = []
    # Could have defaulted to -1 but that is a less obvious API
    if count is None:
        count = -1
    values = get_range(slug)
    for value in values:
        redirect_url, score = value
        ret_val.append({
            'score': score,
            'url': redirect_url
        })
    return ret_val


class RedisObject(object):

    def __init__(self, initial=None):
        self.__dict__['_data'] = {}

        if hasattr(initial, 'items'):
            self.__dict__['_data'] = initial

    def __getattr__(self, name):
        return self._data.get(name, None)

    def __setattr__(self, name, value):
        self.__dict__['_data'][name] = value

    def to_dict(self):
        return self._data

    def __unicode__(self):
        print "Redis: %s -> %s" % (self.slug, self.urls)

    def save(self):
        pass

    def inc(self):
        pass

    def delete(self):
        pass


class HydraResource(Resource):
    slug = fields.CharField(attribute='slug')
    urls = fields.ListField(attribute='urls', null=True)

    class Meta:
        object_class = RedisObject
        authorization = Authorization()
        authentication = Authentication()

    def get_resource_uri(self, bundle_or_obj):
        try:
            if getattr(bundle_or_obj, 'obj'):
                return "/api/v1/hydra/%s" % remove_slug(bundle_or_obj.obj.slug)
            return "/api/v1/hydra/%s" % remove_slug(bundle_or_obj.slug)
        except:
            return ""

    def obj_create(self, bundle, request=None, **kwargs):
        bundle.obj = RedisObject(bundle.data)
        bundle = self.full_hydrate(bundle)
        save(bundle.obj.slug, bundle.obj.urls[0])
        return bundle.obj

    def obj_get(self, request=None, pk=None, **kwargs):
        values = get_range(pk)
        if not values:
            raise NotFound("No object matching this pk")
        ret_val = RedisObject()
        ret_val.urls = []
        ret_val.slug = pk
        for value in values:
            redirect_url, score = value
            ret_val.urls.append({
                'score': score,
                'url': redirect_url
            })
        return ret_val

    def obj_get_list(self, request=None, **kwargs):
        ret_val = []
        filter_slug = request.GET.get('slug', None)
        if filter_slug:
            keys = get_keys('%s*' % filter_slug)
        else:
            keys = get_keys("*")
        for key in keys:
            ret_obj = RedisObject()
            ret_obj.urls = []
            ret_obj.slug = remove_slug(key)
            ret_obj.urls = get_urls(remove_slug(key))
            ret_val.append(ret_obj)
        return ret_val

    def obj_update(self, bundle, request=None, **kwargs):
        return self.obj_create(bundle, request, **kwargs)

    def obj_delete(self, request=None, **kwargs):
        delete(kwargs['pk'])

    def obj_delete_list(self, request=None, **kwargs):
        for slug in get_keys('*'):
            r.delete(slug)

    def override_urls(self):
        raw_url = r"^(?P<resource_name>%s)/(?P<pk>^(schema)[^/]+)$"
        return [
            url(raw_url % self._meta.resource_name,
                self.wrap_view('dispatch_detail'),
                name="api_dispatch_detail"),
        ]
