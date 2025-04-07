const token = "j8AqyzxzWToPcBudDE2xABrd";
// const pino = require("pino");
const net = require("net");

var gps = require("gps-tracking");

var options = {
  debug: true, //We don't want to debug info automatically. We are going to log everything manually so you can check what happens everywhere
  port: 6006,
  device_adapter: "GT06",
};

// const transport = pino.transport({
//   target: "@logtail/pino",
//   options: { sourceToken: token },
// });
// Plates: Land cruiser(74740) / UM552, 62940 / um552, 77437 / UM552, 3-B77827 / UM552, A65331/ TK003, 3-16636/ TK003,  B77849 / TK003
const crsTerminals = [
  "0868720062933829",
  "0864943047255027",
  "0358657103600172",
  "0358657103608399",
  "0358657103600453",
  "0358657105060953",
  "0358657104462051",
  "0868720061903625",
  "0868720061906289",
  "0868720061905174",
  "0868720061898619",
  "0358657104517136",
  "0358657103861956",
  "0358657104813964",
];

// const logger = pino(transport);

var server = gps.server(options, function (device, connection) {
  // #######################################################################################################################
  // ################################################# CRS ONLY ############################################################
  // #######################################################################################################################
  let client = new net.Socket();
  let is_proxy_CRS_device = false;
  try {
    client.connect(20859, "193.193.165.165", function () {
      console.log(
        "=========================================================================="
      );
      console.log("CRS- Connected "); // acknowledge socket connection
      console.log(
        "=========================================================================="
      );

      console.log("CRS - CONNECTED.");
    });
    console.log("CRS - DEVICE Connected "); // acknowledge socket connection
  } catch (error) {
    console.log("CRS - ERROR : " + error.message);
    console.log(
      "=========================================================================="
    );
    console.log("CRS - ERROR : " + error.message);
    console.log(
      "=========================================================================="
    );
  }

  client.on("error", (err) => {
    console.log("CRS - Error Connecting : " + err.message);
    console.log("CRS - Error Connecting : " + err.message);
  });

  function bufferToHexString(buffer) {
    var str = "";
    for (var i = 0; i < buffer.length; i++) {
      if (buffer[i] < 16) {
        str += "0";
      }
      str += buffer[i].toString(16);
    }

    console.log("bufferToHexString : ", str);
    return str;
  }

  function isProxyCRSDevice(value) {
    for (var i = 0; i < crsTerminals.length; i++) {
      if (value.indexOf(crsTerminals[i]) > -1) {
        return true;
      }
    }
    return false;
  }

  device.on("connected", function () {
    console.log("DEVICE Connected "); // acknowledge socket connection
    console.log("CRS - I am a new device CONNECTED");
  });

  device.on("disconnected", function () {
    console.log("CRS - Device DISCONNECTED");
    console.log("DEVICE DISConnected "); // acknowledge socket connection
    // client.end(); // kill client after server's response
  });

  device.on("login_request", function (device_id, msg_parts) {
    is_proxy_CRS_device = crsTerminals.includes(device_id);

    console.log("LOGIN_REQUEST EMITTED. My name is " + device_id);

    console.log("LOGIN_REQUEST EMITTED. My name is " + device_id);

    this.login_authorized(true);

    console.log("Ok, " + device_id + ", you're accepted!");
    console.log("LOGIN REQUEST CONTENT : ");
    console.log(JSON.stringify(msg_parts));
  });

  device.on("ping", function (data, msg_parts) {
    console.log("PING REQUEST CONTENT MSG_PARTS: ");
    console.log(JSON.stringify(msg_parts));

    console.log("PING REQUEST CONTENT DATA: ");
    console.log(JSON.stringify(data));
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
      .then((data) => console.log("MooveLocation Returned Data", data));
    /**
     * #######################################################################
     */

    //this = device
    // console.log(
    //   "I'm here: " +
    //     data.latitude +
    //     ", " +
    //     data.longitude +
    //     " (" +
    //     this.getUID() +
    //     ")"
    // );

    //Look what informations the device sends to you (maybe velocity, gas level, etc)
    //    console.log("HERE IS GPS Tracker data sent:", JSON.stringify(data));
    return data;
  });

  device.on("alarm", function (alarm_code, alarm_data, msg_data) {
    console.log("ALARM REQUEST CONTENT MSG_PARTS: ");
    console.log(JSON.stringify(msg_data));

    console.log(
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
      .then((data) => {
        console.log("MooveLocation Returned Result.");
        // console.log(data);
      });
    /**
     * #######################################################################
     */
  });

  //Also, you can listen on the native connection object
  connection.on("data", function (data) {
    // console.log("Connection Obj: " + Object.toString(connection));
    if (is_proxy_CRS_device) {
      //echo raw data package
      console.log(
        "=========================================================================="
      );
      console.log("CRS - RAW DATA emitted : IMEI - " + bufferToHexString(data));
      console.log(
        "=========================================================================="
      );
      client.write(data)
        ? console.log(
            "CRS - Data Written to CRS server : " + bufferToHexString(data)
          )
        : console.log(
            "CRS - NOT Written to CRS server : " + bufferToHexString(data)
          );
      console.log(
        "=========================================================================="
      );
    } else {
      //echo raw data package
      console.log(
        "=========================================================================="
      );
      console.log(
        "MOOVE Location - RAW DATA emitted : IMEI - " + bufferToHexString(data)
      );
      console.log(
        "=========================================================================="
      );
    }
  });
});
