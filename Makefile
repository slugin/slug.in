templates:
	echo "module.exports = " > pecan.js/templates.js
	node build_templates.js >> pecan.js/templates.js

build:
	make templates    
	browserify -r plate pecan.js/site.js > src/media/js/bundle.js
