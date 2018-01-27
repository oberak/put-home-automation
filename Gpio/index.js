var five = require('johnny-five');
var Raspi = require('raspi-io');
var config = require('../config');
//var Sound = require('aplay');
var ADC = require('./ADC');
var Lamps = require('./Lamps');
var Buttons = require('./Buttons');
var Motor = require('./Motor');
// var Rfid = require('./Rfid');
var Member = require('../models/member');
var Log = require('../models/log');
var Windows = require('./Windows');
var Display = require('./Display');
var Motions = require('./Motions');
var Dht = require('./Dht');
//var player = require('play-sound')(opts = {});
var ios = require('socket.io-client');
var streamUrl = 'http://' + config.stream.ip + ':' + config.stream.socketPort;
var sockets = ios(streamUrl);

var board = new five.Board({
    io: new Raspi()
});

/**
 * GPIO Controller
 *
 * @param       {Function} callback (type, index, value)
 * @constructor
 */
function Gpio(server){
    var self = this;
    var security = true;
    var doorLock = false;
    var doorStatus = 0;
    var doorDelay =7;
    var alarm = false;
    // this.rfid = new Rfid(fnCallback);
    this.windows = new Windows(fnCallback);
    this.display = new Display({time:3});
    this.dht = new Dht(fnCallback, {temp:1, humi: 1});

    board.on('ready', function() {
        self.adc = new ADC(five, fnCallback, {gas: 1, flame: 1});
        self.lamps = new Lamps(five);
        self.buttons = new Buttons(five, btnClick);
        self.motions = new Motions(five, fnCallback);
        self.motor = new Motor(five, fnCallback, {time:4.6});
    });

    this.read = function(){
        var rtn = {};
        rtn.gas = this.adc.read(0);
        rtn.flame = this.adc.read(1);
        rtn.lamps = [];
        for(var i=0; i < 8; i++ ){
            rtn.lamps[i] = this.lamps.read(i);
        }
        rtn.windows = [];
        for(i=0; i < 3; i++ ){
            rtn.windows[i] = this.windows.read(i);
        }
        rtn.temperature = self.dht.read(0);
        rtn.humidity = self.dht.read(1);
        return rtn;
    };
    this.setSocket = function(socket){
        this.socket = socket;
    };
    function btnClick(btnNo){
        if(btnNo == 4){

            sockets.emit('alarm',{alarm:true,type:"bell"});

        }else{
            self.lamps.toggle(btnNo);
            // alarm (all lamp blink)
            fnCallback('LAMPS', btnNo, self.lamps.read(btnNo));
        }
    }
    function fnCallback(type, index, value){
        if(self.socket){
            self.socket.emit('control', {type:type, idx:index, value:value});
        }
        //console.log(type, index, value);
        switch (type) {
          case "DOOR":
          doorStatus = value;

          if (value < 1) {
            setDoorLamp(6,5);

          }else {
            setDoorLamp(5,6);
          }
            break;
          case "MOTION":
            console.log('doorStatus', doorStatus);
            if(doorStatus < 0) return;
            switch (index) {
                case 0:
                if (value) {
                  if (!security) {
                    // self.motor.open(doorDelay);
                    // saveLog("Door",type,index, value,"Open the door by inner motion","Hardware");

                }else {
                      sockets.emit('alarm',{alarm:security,type:"inner"});
                      console.log("call stream");
                }
            }
                    break;
                case 1:
                if (value) {
                    if(doorLock){
                        self.motor.toggle();
                        setTimeout(close,10000);
                        saveLog("Door",type,index, value,"Open the door by outer motion","Hardware");
                        console.log('Opening door');

                    }
                    self.lamps.on(4);
                }else {
                    self.lamps.off(4);
                }
                    break;
                default:

            }



            break;
            case "ADC":
                saveLog("Data",type,index, value,"Flame And Gas","Hardware");
              break;
            case "DHT":
                saveLog("Data",type,index, value,"Humidity And Temperature","Hardware");
              break;
            case "LAMPS":
                saveLog("Switch",type,index, value,"Lamps ON/OFF","Hardware");
                break;
            case "WINDOW":
            if(value == false && security){
                sockets.emit('alarm',{alarm:security,type:"inner"});
                console.log("call stream");
                }
                break;
            case "ALARM":
                if(index == 1){
                    console.log("Flame Alarm will on");
                    sockets.emit('alarm',{alarm:true,type:"sec"});
                }else {
                    console.log("Gas Alarm will on");
                    sockets.emit('alarm',{alarm:true,type:"sec"});
                }
                break;
          default:

        }
    }
    function close() {
      self.motor.toggle();
      console.log('close the DOOR');
    }

    function setDoorLamp(i,o){
      if(self.lamps.read(i) == true) return;
      self.lamps.on(i);
      self.lamps.off(o);

    }
    function saveLog(events,type,index,value,dec,src){
      var log = new Log();
      log.events = events;
      log.type = type;
      log.index = index;
      log.value = value;
      log.dec = dec;
      log.src = src;
      log.time = Date.now();
      log.save(function (err,rtn) {
        if(err)throw err;

      });
    }


    var io = require('socket.io')(server);
    io.on('connection', function(socket) {
        self.socket = socket;
        socket.on('control', function(data) {
            console.log('receive client',data);
            switch (data.type) {
              case 'ALL':
              self.socket.emit('control', { type:'ALL', init: self.read()});

                case 'LAMPS':
                  if(self.lamps.read(data.idx) == data.value) return;
                    if(data.value) self.lamps.on(data.idx);
                    else self.lamps.off(data.idx);
                    saveLog("Switch",data.type,data.idx, data.value,"Lamps ON/OFF","Website");
                    break;
                case 'RFID':
                    Member.findOne({rfid:data.falg},function (err,rtn) {
                      if(err)throw err;
                      if(rtn == null){
                        saveLog("Door",data.type,data.idx, data.falg,"Open door by RFID(Not Register Member)","Client");
                        //saveRfidLog("RFID","Unknow",data.falg,"Not Register Member");
                        //  new Sound().play('/home/pi/home-automation/public/mp3/01.wav');
                        self.display.print('You Are Not','Family Member');
                      }else{
                        if (rtn.options == "use") {
                        saveLog("Door",data.type,data.idx, data.falg,"Open door by RFID(Family Member)","Client");
                          //saveRfidLog("RFID",rtn.name,data.falg,"Family Member");
                          self.display.print('Welcome   ',rtn.name);
                          self.motor.open(doorDelay);
                        }else {
                            saveLog("Door",data.type,data.idx, data.falg,"Open door by RFID(Inactive Family Member)","Client");
                         // saveRfidLog("RFID",rtn.name,data.falg,"Inactive Family Member");
                          self.display.print('You Are Inactive ','Family Member');
                        }

                      }
                    });

                  break;
              case 'DOOR':
                    if (data.idx == 1) {
                        console.log("DOOR Unlock Set Data", data.type,data.idx,data.value);
                        doorLock = data.value;
                        saveLog("Door",data.type,data.idx, data.falg,"Switch motion by doorLock","Website");
                    }else {
                        if (data.value) {
                        saveLog("Door",data.type,data.idx, data.falg,"Open door by user","Website");
                         self.motor.toggle();
                     }else {
                         self.motor.toggle();
                     }
                        }
                  break;
              case 'SECURITY':
                security =data.value;
                saveLog("Data",data.type,data.idx, data.falg,"Security set","Website");
                if (data.value) {
                    self.lamps.on(7);
                }else {
                    self.lamps.off(7);
                }

                break;
            case "DOORBTN":
                self.motor.open(doorDelay);
                break;
            }
        });
    });
}
module.exports = Gpio;
