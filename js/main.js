/*
 * After a line is manually drawn down the length of the ladder lane,
 * automatically discover all additional lanes and widths under the
 * following assumptions:
 *
 * - There is no significant perspective warping of the image (i.e. lanes are parallel)
 * - Lane orientation is approximately vertical (at least better than 45 degrees)
 * - Selected lane line starts and ends in the "background" luminosity
 */

COLORS = ["#FF0000", "#00FF00", "#0000FF", "#FFFF00", "#FF00FF", "#00FFFF"];

function discover_lanes(imdata, ladder_start, ladder_end) {

  var perpendicular = -1 / slope(ladder_start, ladder_end);

  // to discover lanes and breaks
  var boundaries = [];
  var x = 0;
  var end_x;
  var y, end_y;
  var high_start = null;
  while(x < imdata.width) {
    end_x = ladder_end[0] - (ladder_start[0] - x);
    y = ladder_start[1] + x * perpendicular;
    end_y = ladder_end[1] + x * perpendicular;
    line_data = get_line(imdata, [x, Math.floor(y)], [end_x, Math.floor(end_y)]);
    //console.log([x, Math.floor(y)], [end_x, Math.floor(end_y)], line_data.sort().slice(-5));
    if(is_high_frequency(line_data)) {
      if(high_start == null) {
        high_start = {"ul":[x, y], "ll": [end_x, end_y]};
      }
    } else {
      if(high_start != null) {
        high_start["ur"] = [x-1, y];
        high_start["lr"] = [end_x-1, end_y];
        boundaries.push(high_start);
      }
      high_start = null;
    }
    x++;
  }

  return boundaries;
}

function is_high_frequency(line_data) {
  var sorted = line_data.slice().sort(); // sorted COPY
  var sample_size = line_data.length / 20;
  var low_avg = sum(sorted.slice(0, sample_size)) / sample_size; // avg of lowest 10%
  var high_avg = sum(sorted.slice(-sample_size)) / sample_size; // avg of top 10%
  var margin_size = 5;
  var top_avg = sum(line_data.slice(0, margin_size)) / margin_size;
  var bottom_avg = sum(line_data.slice(-margin_size)) / margin_size;
  var avg = sum(line_data) / line_data.length;

  // threshold % total increase in luminosity across the WHOLE lane AND top and bottom are low
  var diff_threshold = 0.08 * 255;

  if(high_avg - (top_avg + bottom_avg)/2 > diff_threshold && high_avg - bottom_avg > diff_threshold && top_avg - low_avg <= 25 && bottom_avg - low_avg <= 25) {
    console.log(low_avg, high_avg, top_avg, bottom_avg, "high");
    return true;
  } else {
    console.log(low_avg, high_avg, top_avg, bottom_avg, "low");
    return false;
  }
}

function sum(arr) {
  return arr.reduce(function(a,b,i,arr){return a+b;});
}

function slope(st, en) {
  return (en[1] - st[1]) / (en[0] - st[0]);
}

function interpolate_x(y, st, en) {
  return Math.floor(st[0] + (en[0] - st[0]) * (y - en[1]) / (st[1] - en[1]))
}

function interpolate_y(x, st, en) {
  return Math.floor(st[1] + (en[1] - st[1]) * (x - st[0]) / (en[0] - st[0]))
}

function get_line(imdata, line_start, line_end) {
  var pitch = imdata.width;
  var data = imdata.data;
  var line_data = new Int32Array(Math.abs(line_start[1] - line_end[1]));
  for(var y = line_start[1]; y > line_end[1]; y--) {
    // get x as a fraction of the way along the line
    var x = interpolate_x(y, line_start, line_end);
    var idx = (y*pitch + Math.floor(x)) * 4;
    line_data[line_start[1] - y] = data[idx] * 0.21 + data[idx+1] * 0.72 + data[idx+2] * 0.07; // human-perception luminosity
  }
  return smooth(line_data, 3);
}

function smooth(line_data, window_size) {
  var smoothed = new Int32Array(line_data.length);
  for(var i = 0; i < line_data.length; i++) {
    smoothed[i] = sum(line_data.slice(Math.max(0, i-window_size/2), Math.max(window_size, Math.min(line_data.length-1, i+window_size/2+(window_size % 2 ? 1 : 0))))) / window_size;
  }
  return smoothed;
}

function get_lane_data(imdata, lane_boundary) {
  var lane_data = new Int32Array(Math.abs(lane_boundary.ul[1] - lane_boundary.ll[1]));
  for(var x = lane_boundary.ul[0]; x < lane_boundary.ur[0]; x++) {
    var end_x = lane_boundary.ll[0] + (x - lane_boundary.ul[0]);
    var y = interpolate_y(x, lane_boundary.ul, lane_boundary.ur);
    var end_y = interpolate_y(end_x, lane_boundary.ll, lane_boundary.lr);
    var line_data = get_line(imdata, [x, y], [end_x, end_y]);
    for(var i = 0; i < line_data.length; i++) {
      if(i >= lane_data.length) break;
      lane_data[i] += line_data[i];
    }
  }
  for(var i = 0; i < lane_data.length; i++) {
    lane_data[i] /= (lane_boundary.ur[0] - lane_boundary.ul[0]);
  }
  return lane_data;
}

function get_background(line_data, percentile) {
  line_data.sort();
}

function draw_chart(lane_data) {
  var header = ["px"];
  var rows = [];
  var lane_colors = [];
  var min_len = null;
  for(var i = 0; i < lane_data.length; i++) {
    if(min_len == null || lane_data[i].length < min_len) {
      min_len = lane_data[i].length;
    }
  }
  for(var i = 0; i < min_len; i++) {
    rows.push([i]);
  }
  for(var l = 0; l < lane_data.length; l++) {
    header.push("Lane " + l);
    for(var i = 0; i < min_len; i++) {
      rows[i].push(lane_data[l][i]);
    }
    lane_colors.push(COLORS[l % 6]);
  }
  rows.splice(0, 0, header);
  var data = google.visualization.arrayToDataTable(rows);

  var options = {
    title: 'Luminosity by lane',
    curveType: 'function',
    legend: { position: 'bottom' },
    colors: lane_colors
  };

  var chart = new google.visualization.LineChart(chart_div);

  chart.draw(data, options);
}

function Gel(canvas, control) {

  this.control = control;

  this.init = function(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    window.addEventListener("resize", function(e) {
      this.resize();
      this.zoom_fit();
      this.draw();
    }.bind(this), false);

    this.draw_layer = document.createElement("canvas");
    canvas.parentNode.appendChild(this.draw_layer);

    this.resize();
  }

  this.resize = function() {
    this.bbox = canvas.getBoundingClientRect();
    canvas.setAttribute("width", this.bbox.width);
    canvas.setAttribute("height", this.bbox.height);

    this.draw_layer.setAttribute("style", "display:block; position:absolute; left:0px; top:0px; width:" + this.bbox.width + "px; height:" + this.bbox.height + "px;");
    this.draw_layer.setAttribute("width", this.bbox.width);
    this.draw_layer.setAttribute("height", this.bbox.height);
  }

  this.draw = function() {
    this.ctx.clearRect(0, 0, this.bbox.width, this.bbox.height);
    this.ctx.drawImage(this.im, 0, 0, this.im_width * this.zoom_factor, this.im_height * this.zoom_factor);
  }

  this.load = function(im) {
    this.im = im;
    this.im_width = im.naturalWidth;
    this.im_height = im.naturalHeight;
    this.ctx.drawImage(this.im, 0, 0);
    this.im_data = this.ctx.getImageData(0, 0, this.im_width, this.im_height);
    console.log("Raw image is " + this.im_data.width + " x " + this.im_data.height + "px");
    this.zoom_fit();
    this.draw();
  }

  this.data = function() {
    return this.ctx.getImageData(0, 0, this.bbox.width, this.bbox.height);
  }

  this.zoom_factor = 1.0;

  this.zoom_fit = function() {
    this.zoom_factor = Math.min(this.bbox.width / this.im_width, this.bbox.height / this.im_height);
    console.log("Zooming to ", this.zoom_factor);
  }
  
  this.init(canvas);

  this.draw_layer.addEventListener("mousedown", function(e) {
    this.drawing = true;
    var box = this.draw_layer.getBoundingClientRect();
    this.draw_start = [e.clientX - box.left, e.clientY - box.top];
  }.bind(this), false);

  this.draw_layer.addEventListener("mousemove", function(e) {
    if(this.drawing) {
      var box = this.draw_layer.getBoundingClientRect();
      var curr_pos = [e.clientX - box.left, e.clientY - box.top];
      var ctx = this.draw_layer.getContext("2d");
      ctx.clearRect(0, 0, this.bbox.width, this.bbox.height);
      ctx.lineWidth = 2;
      ctx.lineCap = "round";
      ctx.strokeStyle = "#00FF00";
      ctx.beginPath();
      ctx.moveTo(this.draw_start[0], this.draw_start[1]);
      ctx.lineTo(curr_pos[0], curr_pos[1]);
      ctx.stroke();
    }
  }.bind(this), false);

  this.draw_layer.addEventListener("mouseup", function(e) {
    this.drawing = false;
    var box = this.draw_layer.getBoundingClientRect();
    var curr_pos = [e.clientX - box.left, e.clientY - box.top];
    lanes.push(new Lane(lanes.length, this.draw_start, curr_pos, this));

    var ctx = this.draw_layer.getContext("2d");
    ctx.clearRect(0, 0, this.bbox.width, this.bbox.height);
  }.bind(this), false);
}


function Lane(id, start_pos, end_pos, gel) {
  this.id = id;

  this.top = start_pos;
  this.bottom = end_pos;
  if(this.top[1] < this.bottom[1]) { // switch to normalize orientation
    var tmp = this.top;
    this.top = this.bottom;
    this.bottom = tmp;
  }

  this.draw_layer = document.createElement("canvas");
  gel.canvas.parentNode.insertBefore(this.draw_layer, gel.draw_layer); // gel draw layer must stay on top
  this.draw_layer.setAttribute("style", "display:block; position:absolute; left:0px; top:0px; width:" + gel.bbox.width + "px; height:" + gel.bbox.height + "px;");
  this.draw_layer.setAttribute("width", gel.bbox.width);
  this.draw_layer.setAttribute("height", gel.bbox.height);
  this.bbox = this.draw_layer.getBoundingClientRect();

  this.draw = function(lane_boundaries) {
    var ctx = this.draw_layer.getContext("2d");
    ctx.clearRect(0, 0, this.bbox.width, this.bbox.height);
    ctx.lineWidth = 1;
    ctx.lineCap = "round";
    for(var i = 0; i < lane_boundaries.length; i++) {
      ctx.strokeStyle = COLORS[i % 6];
      ctx.beginPath();
      ctx.moveTo(lane_boundaries[i].ul[0], lane_boundaries[i].ul[1]);
      ctx.lineTo(lane_boundaries[i].ur[0], lane_boundaries[i].ur[1]);
      ctx.lineTo(lane_boundaries[i].lr[0], lane_boundaries[i].lr[1]);
      ctx.lineTo(lane_boundaries[i].ll[0], lane_boundaries[i].ll[1]);
      ctx.closePath();
      ctx.stroke();
    }
  }

  this.fit_lane = function() {
  }

  this.add_control = function() {
    var lane_control = new LaneController(this.id);
    gel.control.appendChild(lane_control.node());
  }

  var lane_boundaries = discover_lanes(gel.data(), this.top, this.bottom);

  var lane_data = [];
  for(var i = 0; i < lane_boundaries.length; i++) {
    lane_data.push(get_lane_data(gel.data(), lane_boundaries[i]));
  }
  draw_chart(lane_data);

  console.log(lane_boundaries);
  this.draw(lane_boundaries);
  //this.add_control();
}

function LaneController(id) {
  var div = document.createElement("div");
  div.classList.add("lane_controller");

  this.node = function() {
    return div;
  }

  var title = document.createTextNode("Lane " + id);
  div.appendChild(title);
}


var gel;
var lanes = [];
var chart_div;

window.addEventListener("load", function() {

  // ---------------------------------
  // Set up toolkit interface
  // ---------------------------------

  var control_div = document.getElementById("control");
  chart_div = document.createElement("div");
  control_div.appendChild(chart_div);
  google.charts.load('current', {'packages':['corechart']});


  // ---------------------------------
  // Set up Gel object
  // ---------------------------------

  var main_div = document.getElementById("display");
  var canvas = document.getElementById("canvas");
  gel = new Gel(canvas, control_div);

  // setup drag/drop
  main_div.addEventListener("dragover", function(e) {
    e.preventDefault();
    return false;
  }, false);
  main_div.addEventListener("drop", function (e) {
    e.preventDefault();
    var file = e.dataTransfer.files[0];
    console.log("File size: " + file.size);
    if(file.size > 100000000) {
      var doit = confirm("The file you are attempting to load is over 100Mb. This may cause your browser and computer to freeze. Do you wish to proceed?");
      if (!doit) {
        return false;
      }
    }
    load_file(file);
    return false;
  }, false);

  var load_file = function(file) {
    if (!file) {
      return null;
    }
    console.log("Loading local file '" + file.name + "'...");
    var reader = new FileReader();
    reader.onload = function (event) {
      file_loaded(file.name, event.target.result, true);
    }
    reader.onerror = function (event) {
      // why not display the error here directly?
      file_loaded(file.name, null, false);
    }
    reader.readAsDataURL(file);
  }

  var file_loaded = function(fname, content, success) {
    if (success) {
      console.log(fname + " loaded");
      var img = new Image(); // same as document.createElement("img")
      img.addEventListener("load", function() {
        if(this.complete) {
          gel.load(this);
        }
      }, false);
      img.setAttribute("src", content);
    } else {
      // why do this here and not in the callback itself?
      console.error("Error parsing image '" + fname + "'.");
    }
  }

  var ctx = canvas.getContext("2d");
  ctx.font = "30px Courier";
  ctx.fillText("Drag and drop your gel image here", 20, 40);

}, false);

