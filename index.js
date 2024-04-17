var gps = require("gps-tracking");

var options = {
  debug: true, //We don't want to debug info automatically. We are going to log everything manually so you can check what happens everywhere
  port: 6006,
  device_adapter: "GT06",
};

var server = gps.server(options, function (device, connection) {
  device.on("connected", function (data) {
    console.log("I'm a new device connected");
    console.log("DEVICE DATA : ", data?.toString());
    return data;
  });

  device.on("login_request", function (device_id, msg_parts) {
    console.log(
      "Hey! I want to start transmiting my position. Please accept me. My name is " +
        device_id
    );

    this.login_authorized(true);

    console.log("Ok, " + device_id + ", you're accepted!");
    console.log("LOGIN REQUEST CONTENT : ", JSON.stringify(msg_parts));
  });

  device.on("ping", function (data, msg_parts) {
    //this = device
    console.log(
      "I'm here: " +
        data.latitude +
        ", " +
        data.longitude +
        " (" +
        this.getUID() +
        ")"
    );

    //Look what informations the device sends to you (maybe velocity, gas level, etc)
    console.log("HERE IS GPS Tracker data sent:", JSON.stringify(data));
    return data;
  });

  device.on("alarm", function (alarm_code, alarm_data, msg_data) {
    console.log(
      "Help! Something happend: " + alarm_code + " (" + alarm_data.msg + ")"
    );
  });

  //Also, you can listen on the native connection object
  connection.on("data", function (data) {
    //echo raw data package
    //    console.log("RAW DATA PACKAGE ECHO : ", JSON.stringify(data));
  });
});
