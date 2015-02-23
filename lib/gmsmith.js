var fs = require('fs'),
	os = require('os'),
	async = require('async'),
	assert = require('assert'),
	tempfile = require('tempfile'),
	which = require('which'),
	_gm = require('gm'),
	gmExists = false,
	exporters = {},
	engine = {},
	settings = {};

try {
	gmExists = !!which.sync('gm');
} catch (e) {
	// Ignore errors for `gm` not existing
}

// Helper function to set settings
// ANTI-PATTERN: We are treaing gmsmith as a singleton and should re-design the
// API to have options at every step
function set(_options) {
	// Save settings
	Object.getOwnPropertyNames(_options).forEach(function saveOption(_key) {
		settings[_key] = _options[_key];
	});
}

// Helper method to clear all settings
function clear() {
	settings = {};
}

// Getter method for settings
function get(_key) {
	return settings[_key];
}

// Helper method for grabbing gm instance (graphicsmagick vs imagemagick)
function getGm() {
	var useImagemagick = get('imagemagick');
	if (useImagemagick || (useImagemagick === undefined && !gmExists)) {
		return _gm.subClass({imageMagick: true});
	} else {
		return _gm;
	}
}

// Expose get/set to engine
engine.get = get;
engine.set = set;
engine.clearSettings = clear;

function Canvas() {
	var gm = getGm(),
		canvas = gm(1, 1, 'transparent');

	// Override the -size options (won't work otherwise)
	canvas._in = ['-background', 'transparent'];

	// Save the canvas
	this.canvas = canvas;
}
Canvas.prototype = {
	'addImage': function addImage(_img, _x, _y, _cb) {
		// Add the image
		var canvas = this.canvas;

		// TODO: Pull request this in to gm
		canvas.out('-page');
		canvas.out('+' + _x + '+' + _y);
		canvas.out(_img.file);
	},
	'export': function exportFn(_options, _cb) {
		// Grab the exporter
		var canvas = this.canvas;
		var format = _options.format || 'png';
		var exporter = exporters[format];

		// Assert it exists
		assert(exporter, 'Exporter ' + format + ' does not exist for spritesmith\'s gm engine');

		// Flatten the image (with transparency)
		canvas.mosaic();

		// Render the item
		exporter.call(this, _options, _cb);
	}
};

// Expose Canvas to engine
engine.Canvas = Canvas;

// Create paths for the scratch directory and transparent pixel
function createCanvas(_width, _height, _cb) {
	// Generate a scratch file
	var filepath = tempfile('.png');

	async.waterfall([
		function generateCanvas(_cb) {
			// Generate a transparent canvas
			var gm = getGm(),
				base = gm(_width, _height, 'transparent');

			// Write out the base file
			base.write(filepath, _cb);
		},
		function destroyScratchFile(_x, _y, _z, _cb) {
			// Ignore destory errors
			fs.unlink(filepath, function () {
				_cb(null);
			});
		},
		function loadBackCanvas(_cb) {
			// Create a canvas
			var canvas = new Canvas();

			// Callback with it
			_cb(null, canvas);
		}
	], _cb);
}

// Expose createCanvas to engine
engine.createCanvas = createCanvas;

// Write out Image as a static property of Canvas
/**
 * @param {String} file File path to load in
 * @param {Function} callback Error first callback to retrun the image from
 * @prop {Number} image.width
 * @prop {Number} image.height
 * @note Must be guaranteed to integrate into own library via .addImage
 */
function createImage(_file, _cb) {
	// Create the image
	var gm = getGm(),
		img = gm(_file);

	// In series...
	async.waterfall([
		// Grab the size
		function getImgSize(_cb) {
			img.size(_cb);
		},
		function saveImgSize(_size, _cb) {
			// Create a structure for preserving the height and width of the
			// image
			var imgFile = {
				'height': _size.height,
				'width': _size.width,
				'file': _file
			};

			// Callback with the imgFile
			_cb(null, imgFile);
		}
	], _cb);
}
engine.createImage = createImage;

function createImages(_files, _cb) {
	// Map the files into their image counterparts
	// DEV: Magic number of 10 to prevent file descriptor overuse
	// This does not affect perf -- 12 seconds with 300, 11.5 with 10 for 2000
	// images (derp)
	async.mapLimit(_files, os.cpus().length, createImage, _cb);
}
engine.createImages = createImages;

// Function to add new exporters
function addExporter(_name, _exporter) {
	exporters[_name] = _exporter;
}

// Expose the exporters
engine.exporters = exporters;
engine.addExporter = addExporter;

// Helper to create gm exporters (could be a class for better abstraction)
function getGmExporter(_ext) {
	/**
	 * Generic gm exporter
	 * @param {Object} options Options to export with
	 * @param {Number} [options.quality] Quality of the exported item
	 * @param {Function} cb Error-first callback to return binary image string
	 *     to
	 */
	return function gmExporterFn(_options, _cb) {
		var canvas = this.canvas;
		var filepath = tempfile('.' + _ext);

		// Update the quality of the canvas (if specified)
		var quality = _options.quality;
		if (quality !== undefined) {
			canvas.quality(quality);
		}

		async.waterfall([
			// Write to file
			function writeOutCanvas(_cb) {
				canvas.write(filepath, _cb);
			},
			// Read the file back in (in binary)
			function readInCanvas(_x, _y, _z, _cb) {
				fs.readFile(filepath, 'binary', _cb);
			},
			// Destroy the file
			function destroyFile(retVal, _cb) {
				fs.unlink(filepath, function () {
					_cb(null, retVal);
				});
			}
		], _cb);
	};
}

// Generate the png exporter
var gmPngExporter = getGmExporter('png');
addExporter('png', gmPngExporter);
addExporter('image/png', gmPngExporter);

// Generate the jpeg exporter
var gmJpegExporter = getGmExporter('jpeg');
addExporter('jpg', gmJpegExporter);
addExporter('jpeg', gmJpegExporter);
addExporter('image/jpg', gmJpegExporter);
addExporter('image/jpeg', gmJpegExporter);

// This does not seem to be working at the moment
// // Generate the tiff exporter
// var gmTiffExporter = getGmExporter('tiff');
// addExporter('tiff', gmTiffExporter);
// addExporter('image/tiff', gmTiffExporter);

// Export the canvas
module.exports = engine;