const token = 'j8AqyzxzWToPcBudDE2xABrd';
const pino = require('pino');

var gps = require("gps-tracking");

var options = {
  debug: true, //We don't want to debug info automatically. We are going to log everything manually so you can check what happens everywhere
  port: 6006,
  device_adapter: "GT06",
};


const transport = pino.transport({
  target: "@logtail/pino",
  options: { sourceToken: token }
});
const logger = pino(transport);



var server = gps.server(options, function (device, connection) {
  device.on("connected", function () {
    //    logger.info("I'm a new device CONNECTED");
    logger.info('I am a new device CONNECTED');
  });
  device.on("disconnected", function () {
    logger.info("Device DISCONNECTED");

  });

  device.on("login_request", function (device_id, msg_parts) {
    logger.info("LOGIN_REQUEST EMITTED. My name is " + device_id);

    this.login_authorized(true);

    logger.info("Ok, " + device_id + ", you're accepted!");
    logger.info("LOGIN REQUEST CONTENT : ", JSON.stringify(msg_parts));
  });

  device.on("ping", function (data, msg_parts) {
    logger.info("PING REQUEST CONTENT MSG_PARTS: ", JSON.stringify(msg_parts));
    logger.info("PING REQUEST CONTENT DATA: ", JSON.stringify(data));
    /**
     * #######################################################################
     * ########## SENDING LOCATION INFORMATION TO SERVER ######################
     * #######################################################################
     */
    fetch(`http://78.47.144.132:3000/api/GPSLocationFeed`, {
      method: "POST",
      mode: "cors",
      body: JSON.stringify({ data: data }),
      headers: {
        "Content-Type": "application/json; charset=UTF-8",
      },
    })
      .then((response) => response.json())
      .then((data) => logger.info("MooveLocation Returned Data", data));
    /**
     * #######################################################################
     */

    //this = device
    // logger.info(
    //   "I'm here: " +
    //     data.latitude +
    //     ", " +
    //     data.longitude +
    //     " (" +
    //     this.getUID() +
    //     ")"
    // );

    //Look what informations the device sends to you (maybe velocity, gas level, etc)
    //    logger.info("HERE IS GPS Tracker data sent:", JSON.stringify(data));
    return data;
  });

  device.on("alarm", function (alarm_code, alarm_data, msg_data) {
    logger.info("ALARM REQUEST CONTENT MSG_PARTS: ", JSON.stringify(msg_data));

    logger.info(
      "Help! Something happend: " + alarm_code + " (" + alarm_data.msg + ")"
    );

    /**
     * #######################################################################
     * ##########SENDING ALARM AND LOCATION INFORMATION TO SERVER ############
     * #######################################################################
     */
    fetch(`http://78.47.144.132:3000/api/GPSLocationFeed`, {
      method: "POST",
      mode: "cors",
      body: JSON.stringify({ data: alarm_data }),
      headers: {
        "Content-Type": "application/json; charset=UTF-8",
      },
    })
      .then((response) => response.json())
      .then((data) => logger.info("MooveLocation Returned Data", data));
    /**
     * #######################################################################
     */
  });

  //Also, you can listen on the native connection object
  connection.on("data", function (data) {
    //echo raw data package
    logger.info("RAW DATA emitted : ", data);
  });
});
