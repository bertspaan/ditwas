#!/usr/bin/env node

var argv = require('minimist')(process.argv.slice(2));
var readline = require('readline');
var config = require('./config');
var fs = require('fs');
var path = require('path');
var chalk = require('chalk');
var H = require('highland');
var ExifImage = require('exif').ExifImage;
var mkdirp = require('mkdirp');
var spawn = require('child_process').spawn;

var askQuestion = H.wrapCallback(function(question, callback) {
  var rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  rl.question(question, function(answer) {
    rl.close();
    if (answer) {
      callback(null, answer);
    } else {
      callback('FOUT!')
    }
  });
});

var toDecimal = function(degreeArray, ref) {
  var sign = 1;
  if (ref.toLowerCase() === 'w' || ref.toLowerCase() === 's') {
    sign = -1;
  }

  var degrees = degreeArray[0];
  var minutes = degreeArray[1];
  var seconds = degreeArray[2];

  var decimals = 1000000;
  return Math.round((degrees + minutes / 60 + seconds / 3600) * sign * decimals) / decimals;
}

var exif = function(data, callback) {
  new ExifImage({image: data.filename}, function (error, exifData) {
    if (error) {
      callback(error)
    } else {
      var createDate = exifData.exif.CreateDate;
      var date = createDate.slice(0, 10).replace(/:/g, '-');

      var newData = {
        date: date
      };

      if (exifData.gps && exifData.gps.GPSLongitude && exifData.gps.GPSLongitudeRef) {
        newData.coordinates = [
          toDecimal(exifData.gps.GPSLongitude, exifData.gps.GPSLongitudeRef),
          toDecimal(exifData.gps.GPSLatitude, exifData.gps.GPSLatitudeRef)
        ]
      }

      console.log(
        `Deze doen: ${chalk.underline(data.filename)}, datum ${date}` +
        (newData.coordinates ? `, positie ${newData.coordinates.join(', ')}` : '')
      )
      callback(null, Object.assign(data, newData));
    }
  });
}

var askQuestions = function(data, callback) {
  var answers = {};

  H([
    'Nieuwe bestandsnaam: ',
    'Titel: ',
    'Dit was '
  ])
    .map(askQuestion)
    .series()
    .toArray(function(answers) {
      callback(null, Object.assign(data, {
        newFilename: answers[0],
        title: answers[1],
        contents: answers[2]
      }));
    });
}

var moveAndRename = function(data, callback) {
  var newDir = path.join(config.photos, data.date);
  var newPath = path.join(newDir, data.newFilename + path.extname(data.filename));

  mkdirp.sync(newDir);
  fs.renameSync(data.filename, newPath)

  callback(null, Object.assign(data, {newPath: newPath}));
};

var createHtml = function(data, callback) {
  var htmlDir = path.join(config.website, data.date);
  var htmlFilename = path.join(htmlDir, data.newFilename + '.html');

  var lines = [
    '---',
    `title: ${data.title}`
  ];

  if (data.coordinates) {
    lines.push(
      'coordinates: ' + JSON.stringify(data.coordinates)
    );
  }

  lines.push(
    '---',
    '',
    data.contents,
    '\n'
  );

  var contents = lines.join('\n');

  mkdirp.sync(htmlDir);
  fs.writeFileSync(htmlFilename, contents)

  callback(null, data)
};

var s3Photo = function(data, callback) {
  var cmd = spawn('s3-photo', [data.newPath]);
  cmd.stdout.pipe(process.stdout);
  cmd.stderr.pipe(process.stderr);

  cmd.on('exit', function (code) {
    callback(null, data);
  });
};

// TODO: git commit! https://github.com/nodegit/nodegit

H(argv._)
  .map(filename => ({filename: filename}))
  .map(H.curry(exif))
  .nfcall([])
  .series()
  .map(H.curry(askQuestions))
  .nfcall([])
  .series()
  .map(H.curry(moveAndRename))
  .nfcall([])
  .series()
  .map(H.curry(createHtml))
  .nfcall([])
  .series()
  .map(H.curry(s3Photo))
  .nfcall([])
  .series()
  .done(function() {
    console.log(chalk.green('Klaar!'));
  });
