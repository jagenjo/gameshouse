//this SDK is meant to be used by the GameServer to communicate with the GameClient and store
//data in the server. 

//include by putting require(GLOBAL.GSDKC)

var https      = require('https');
var WebSocketServer = require('ws').Server;
var colors = require('colors');

var redis = require('./database').redis;
var sql = require('./database').mysql;
var Users = require('./users');
var GamesDB = require('./gamesDB');
var util = require("util");
var Url = require("url");
var fs = require("fs");

var in_server = true;
var port_start_range = 8200;
var ports_in_use = {};
var last_client_id = 1;

function getTime(){
	var t = process.hrtime();
	return t[0]*0.001 + t[1]*(1e-6);
}

var SDK_VERSION = "0.103";

//game_data is data stored in the DB
//game_info is the game type information
function GameServerInstance( game_data, game_info, server_port, config )
{
	//console.log('GameServerInstance created');

	this.game_id = game_data.id;

	this.data = game_data;
	this.game_info = game_info;
	this.port = server_port || -1;
	this.config = config;

	this.clients = []; //websockets connected, contains { username, user_key, id }
	this.binded = {};
	this.version = SDK_VERSION;
	this.verbose = true;
	
	this.state = "STARTING";

	this.db = null;
	this.host = null;
	
	//this.launchServer();
}

GameServerInstance.version = SDK_VERSION;

GameServerInstance.prototype.start = function()
{
	this.launchServer();
	this.pullEvents();
	this.state = "RUNNING";
}

/* serialization */

//store key:data
GameServerInstance.prototype.storeData = function( key, data )
{
	redis.set( "bg:games:" + this.game_id + ":data:" + key, data);
}

//retrieve data with key
GameServerInstance.prototype.loadData = function( key, callback, error )
{
	var fullkey = "bg:games:" + this.game_id + ":data:" + key;
	redis.get( fullkey, function(err,val) { 
		if(err && error)
			return error(err);
		callback(val) 
	});
}

//topic represents the public info about the state of the game
GameServerInstance.prototype.setTitle = function( msg )
{
	this.db.updateGameField( this.game_id, "title", msg );
}

//topic represents the public info about the state of the game
GameServerInstance.prototype.setTopic = function( msg )
{
	this.db.updateGameField( this.game_id, "topic", msg );
}


/* events */ 

//send message to all clients
GameServerInstance.prototype.sendMessage = function( msg, data )
{
	if (data !== undefined)
	{
		if (data.constructor === String)
			msg = msg + "|" + data;
		else
			msg = msg + "|" + JSON.stringify(data);
	}
	
	var num = 0;
	
	for(var i in this.clients)
	{
		var client = this.clients[i];
		client.send( msg );
		num++;
	}
	
	if(this.verbose)
		console.log(" => '" + msg.substr(0,30) + (msg.length > 20 ? "..." :"") + "' to " + num + ' clients');
}

/* game status actions */

GameServerInstance.prototype.sleep = function()
{
	if(this.state == "SLEEPING")
		return;
	this.state = "SLEEPING";
	this.dispatchEvent("sleep");
	this.closeServer();
	this.host.removeGameInstance( this );
}

GameServerInstance.prototype.getInfo = function()
{
	var gameinfo = {};
	gameinfo.data = this.data;
	gameinfo.port = this.port;
	return gameinfo;
}

/* clients */
GameServerInstance.prototype.getClients = function()
{
	return this.clients.concat();
}


GameServerInstance.prototype.getPlayers = function(callback)
{
	this.db.getPlayersInGame( this.game_id, callback );
}

GameServerInstance.prototype.setPlayerScore = function( username, score, callback )
{
	this.db.setPlayerField( this.game_id, username, "score", score, callback );
}

GameServerInstance.prototype.setPlayerInfo = function( username, text, callback )
{
	this.db.setPlayerField( this.game_id, username, "info", text, callback );
}

/* events */
GameServerInstance.prototype.addEventListener = function(type, callback)
{
	var callbacks = this.binded[type];
	if(!callbacks)
		callbacks = this.binded[ type ] = [];
	callbacks.push(callback);
}

GameServerInstance.prototype.removeEventListener = function(type, callback)
{
	var callbacks = this.binded[type];
	if(!callbacks) return;
	
	var pos = callbacks.indexOf(callback);
	if(pos != -1)
		callback.splice(pos,1);	
}

GameServerInstance.prototype.dispatchEvent = function(type, evt)
{
	var callbacks = this.binded[type];
	if(!callbacks)
		return;

	for(var i in callbacks)
	{
		try
		{
			var r = callbacks[i](evt,type);
			if(r)
				return r;
		}
		catch (err)
		{
			console.error("******************************************************".red);
			console.error("Error in game: ".red, err.toString());
			console.error(err.stack);
			console.error("******************************************************".red);
		}
	}
}

// returns an event from the game event queue (stored in redis)
// events could be players leaving the game, user interactions outside of the game...
GameServerInstance.prototype.pullEvents = function()
{
	var that = this;
	var key = "bg:games:" + this.game_id + ":events";
	redis.lpop(key, on_element);
	
	function on_element(err,data) {
		if (err || !data)
			return;
		
		try
		{
			var event = JSON.parse(data);
			that.dispatchEvent("system",event);
		}
		catch(err)
		{
			console.error("error parsing event in redis");
		}

		//get next event		
		redis.lpop(key, on_element);
	}
}

/* connection */

//called from GameServerInstance.prototype.start
GameServerInstance.prototype.launchServer = function()
{
	var that = this;

	//compute port
	var port = this.port;
	if(port == -1)
	{
		port = 8200;
		while( ports_in_use[port] )
			port++;
	}
	ports_in_use[port] = true;
	this.port = port;

	var options = {};
	if(this.config.certs && this.config.certs.public && this.config.certs.private )
	{
		var cert = fs.readFileSync(this.config.certs.public);
		var key = fs.readFileSync(this.config.certs.private);
		//console.log(cert,key);
		options.key = key;
		options.cert = cert;
	}

	var httpserver = https.createServer( options );
	httpserver.listen(port);
	this.httpserver = httpserver;

	var wsserver = new WebSocketServer({server:httpserver});
	this.wsserver = wsserver;
	
	//somebody connecting to the game
	wsserver.on('connection', function( ws, req ) {

		req = req || ws.upgradeReq;
		var key = req.url.substr(1);
		ws.client_id = last_client_id++;
		console.log(' :: new connection: ', key );
		
		//check if valid user key
		Users.isKeyValid( key, function(username){
			if(!username) //unknown user connecting
			{
				console.log(' :: invalid user' );
				ws.close();
				return;
			}
			
			that.db.isPlayerInGame( username, that.game_id, function(v) {
				ws.username = username;
				ws.user_key = key;
				ws.send("READY");
				that.clients.push(ws);
				that.dispatchEvent("player_connected", ws);
			});
		});

		ws.on('message', function(data) {
			//event.client = ws;
			if (!this.username) {
				this.send("WAIT");
				if(that.verbose)
					console.log("Warning: msg received while waiting: ", data);
				return;
			}
			
			if(that.verbose)
				console.log(" <= '" + data + "' from " + ws.client_id);

			that.dispatchEvent("player_message", { type:"player_message", username: this.username, data: data, ws: ws });
		});

		//closed connection
		ws.on('close', function(event) {
			if(that.verbose)
				console.log(' :: closed connection: ', ws.client_id);
			
			//remove from clients list
			var pos = that.clients.indexOf(this);
			if(pos != -1)
				that.clients.splice(pos,1);
			else
				console.error("Client not found when removing from clients list");
				
			that.dispatchEvent("player_disconnected", this);
			ws = null;
		});
		
		ws.sendMessage = function( msg, data )
		{
			if (data !== undefined)
			{
				if (data.constructor === String)
					msg = msg + "|" + data;
				else
					msg = msg + "|" + JSON.stringify(data);
			}
			this.send(msg);
		}
	});


	//server.listen( port );
	console.log(" :: Core Instance server in port " + port );
}

//send close signal to all the clients connected
GameServerInstance.prototype.closeServer = function()
{
	for(var i in this.clients)
	{
		try
		{
			this.clients[i].close();
		}
		catch(err)
		{
		}
	}
	
	if (this.wsserver) {
		this.wsserver.close();
		this.wsserver = null;
	}
}

GameServerInstance.prototype.log = function( msg )
{
	var final_msg = Array.prototype.slice.call(arguments).join(" ");

	//store inside the game log
	var that = this;
	var key = "bg:games:" + this.game_id + ":log";
	redis.rpush( key, JSON.stringify( { time: getTime(), msg: String(final_msg) }) );
	//TODO: TRIM LOG?

	//verbose
	if( this.verbose )
		console.log( (" ["+this.game_id+"] " + final_msg).cyan );
}



//************

var GSDKC = {
	launch: function()
	{
		
	}
};

exports.GameServerInstance = GameServerInstance;
exports.sdk = GSDKC;
