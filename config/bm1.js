(function() {

var isSeeking = false;
var lastVideoRepresentation = null;
var availableVideoRepresentations, availableAudioRepresentations;
var videoDownloadCount = 0;
var bandwidthMeasurements = [];

function getLowerVideoRepresentation(id) {
  var currentIndex = availableVideoRepresentations.map(function(rep) {
    return rep.id;
  }).indexOf(id);

  return availableVideoRepresentations[Math.max(0, currentIndex - 1)];
}

function getVideoRepresentationById(id) {
  return availableVideoRepresentations.find(function(rep) {
    return id === rep.id;
  });
}

function getNearestAudioRepresentation(bandwidth) {
  for(var i = availableAudioRepresentations.length - 1; i >= 0; i--) {
    if(availableAudioRepresentations[i].bitrate <= bandwidth) {
      return availableAudioRepresentations[i];
    }
  }

  return availableAudioRepresentations[0];
}

function calcAverageBandwidth() {
  return Math.round(bandwidthMeasurements.reduce(function(acc, val) {
        return acc + val;
      }, 0) / bandwidthMeasurements.length) || 0;
}

var player = null;

window.bmParams = {
  tweaks: {
    log_level: 1,
    RESTART_THRESHOLD: 5
  },
  events: {
    onReady: function() {
      var allBmPlayers = window.bitmovin.player('*');
      player = allBmPlayers[1] || allBmPlayers[0];

      availableVideoRepresentations = player.getAvailableVideoQualities();
      availableAudioRepresentations = player.getAvailableAudioQualities();
    },
    onSeek: function() {
      // save representation one below current (better
      var currentRepresentation = player.getDownloadedVideoData();
      lastVideoRepresentation = getLowerVideoRepresentation(currentRepresentation.id);
      console.log('set lastRepresentation on seek: ' + lastVideoRepresentation.id);
      isSeeking = true;
    },
    onStartBuffering: function() {
      console.log('onStartBuffering', {
        video: player.getVideoBufferLength(),
        audio: player.getAudioBufferLength()
      });
      if(!isSeeking && lastVideoRepresentation) {
        console.log('reset set lastRepresentation on stall');
        lastVideoRepresentation = null;
      }
    },
    onStopBuffering: function() {
      console.log('onStopBuffering');
      isSeeking = false;
    },
    onDownloadFinished: function(evt) {
      if (evt.downloadType === 'media' && evt.mimeType.indexOf('video') > -1 && evt.size > 2000) {
        videoDownloadCount++;

        var measurement = (evt.size * 8) / evt.downloadTime;
        console.info('BANDWIDTH', measurement, JSON.stringify(bandwidthMeasurements));
        bandwidthMeasurements.push(measurement);
        if(bandwidthMeasurements.length > 5) {
          bandwidthMeasurements.shift();
        }

        // set current average bandwidth as new startup bitrate
        localStorage.setItem('startup_bitrate', calcAverageBandwidth() / 1000 / 1000);
      }
    }
  },
  adaptation: {
    desktop: {
      onVideoAdaptation: function(evt) {
        var suggestedRepresentation = getVideoRepresentationById(evt.suggested);

        if(isSeeking && lastVideoRepresentation) {
          console.log('keep representation during seeking: ' + lastVideoRepresentation.id);
          // return last representation during seeking
          return lastVideoRepresentation.id;
        }

        if(lastVideoRepresentation && lastVideoRepresentation.bitrate > suggestedRepresentation.bitrate) {
          console.log('onVideoAdaptation (override), ' + JSON.stringify({
              id: lastVideoRepresentation.id,
              bitrate: (lastVideoRepresentation.bitrate / 1000000).toFixed(2),
              videoBuffer: player.getVideoBufferLength(),
              audioBuffer: player.getAudioBufferLength()
            }));
          return lastVideoRepresentation.id;
        } else if(lastVideoRepresentation) {
          console.log('reset adaptation logic override');
          // reset adaptation logic override
          lastVideoRepresentation = null;
        }

        console.log('onVideoAdaptation (suggested), ' + JSON.stringify({
            id: evt.suggested,
            bitrate: (suggestedRepresentation.bitrate / 1000000).toFixed(2),
            videoBuffer: player.getVideoBufferLength(),
            audioBuffer: player.getAudioBufferLength()
          }));
        // return suggested representation ID
        return evt.suggested;
      },
      onAudioAdaptation: function(evt) {
        // choose audio representation on 10% of average bandwidth
        var averageBandwidth = calcAverageBandwidth();
        var selectedAudioRepresentation = getNearestAudioRepresentation(averageBandwidth * 0.1);

        console.log('onAudioAdaptation ' + JSON.stringify({
            bandwidth: averageBandwidth,
            suggested: evt.suggested,
            selected: selectedAudioRepresentation.id,
            bitrate: selectedAudioRepresentation.bitrate
        }));

        return selectedAudioRepresentation.id;
      }
    }
  }
};

})();
