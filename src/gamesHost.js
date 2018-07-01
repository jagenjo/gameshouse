//the games host is in charge of launching games and sleeping

var fs = require('fs');
var colors = require('colors');

var Users = require('./users');
var GamesDB = require('./gamesDB');
var DB = require('./database');
var redis = DB.redis;

var GameServerInstance = require('./gamesSDKServer').GameServerInstance;

var GSDK_PATH = '../public/games/gamesSDK.js';

function GamesHost()
{
	this.active_instances = {};
	this.num_active_instances = 0;

	this.games_list = {};
	this.db = null;
}

GamesHost.prototype.init = function( server, config )
{
	var that = this;
	this.db = server.db;

	console.log(" * SDK version: ", GameServerInstance.version );
	
	//relaunch all games in the same port as they were
	redis.get( 'bg:host_state', function(err, val){
		if(val === null)
			return;
		var status = JSON.parse(val);
		for(var i in status)
		{
			var game_id = status[i][0];
			var port = status[i][1];
			
			//get game data from DB
			that.db.getGameById( game_id, (function( game_data ) {
				if(!game_data)
					return; 
				that.launchGame( game_data, this.port );
			}).bind({ id: game_id, port: port }) );
		
		}		
	});
	
	redis.del( 'bg:host_state' );
}

//loads the list with all available games in the system
GamesHost.prototype.loadGamesList = function( url )
{
	this.games_list = JSON.parse( fs.readFileSync( url, 'utf8') );
	console.log("Games loaded:");
	for(var i in this.games_list)
		console.log(" - ",i);
}

//used for hooking events to httpd
GamesHost.prototype.registerPaths = function( express_server )
{
	express_server.get("/action/getAvailableGamesList", this.actionGetGamesList.bind(this));
	express_server.get("/action/playGame", this.actionPlayGame.bind(this));
	express_server.get("/action/launchGame", this.actionLaunchGame.bind(this));
	express_server.get("/action/sleepGame", this.actionSleepGame.bind(this));
	express_server.get("/action/getRunningGames", this.actionGetRunningGames.bind(this));
}

//returns a list with the available games supported
GamesHost.prototype.actionGetGamesList = function(req, resp)
{
	var games = {};
	for(var i in this.games_list)
	{
		var game = this.games_list[i];
		games[i] = { name: game.name, description: game.description, version: game.version };
	}
	return resp.send({ status: 1, games: games } );
}


//get a list with all the game isntances running
GamesHost.prototype.actionGetRunningGames = function(req, resp)
{
	var games = [];
	for(var i in this.active_instances)
	{
		var instance = this.active_instances[i];
		var core = instance.core;
		var info = instance.game_type + ":: ";
		if(core.getStatusInfo)
			info += core.getStatusInfo();
		games.push( info );
	}
	return resp.send({ content: { status: 1, games: games, numgames: this.num_active_instances } });
}

//validate form to launch game
GamesHost.prototype.actionLaunchGame = function(req, resp)
{
	var that = this;
	var db = this.db;

	//check login
	Users.checkKey(req, resp, function(username)
	{
		var game_id = parseInt( req.query["game_id"] );
		var key = req.query["key"];
		
		//check if game exist
		db.getGameById( game_id, function( game_data ) {
			if(!game_data)
				return resp.send({status: -1, msg: "no game found with that id"});
				
			//prepare game instance
			var instance = that.getRunningInstance( game_id );
			if(!instance)
			{
				console.log("launching instance to play");
				instance = that.launchGame( game_data );
			}

			if(!instance) //something went wrong creating the game
				return;

			//compute link
			var game_info = instance.game_info;
			var path = game_info.launch + "?game_id="+game_id+"&key="+key;

			resp.send({status: 1, msg: "game ready to play", username: username, info: { path: path, port: instance.port } });
		}); 
	});
	
	return true;
}

//to launch a game we need to have fetched the game data first
GamesHost.prototype.launchGame = function( game_data, port )
{
	//got the game info, now launch instance
	var game_type = game_data.game;

	if( this.active_instances[ game_data.id ] )
	{
		console.warn("Warning: relaunching an existing game");
		return this.active_instances[ game_data.id ];
	}
	
	var game_info = this.games_list[ game_type ];
	if(!game_info)
	{
		console.log("game class not found: " + game_type );
		return null;
	}

	//LOAD FILES
	var base_path = game_info.folder + "/";
	var files = [];

	if(game_info.includes)
		files = files.concat( game_info.includes );
	var game_code = ""; //"var exports = undefined;\n";

	for(var i = 0; i < files.length; i++)
	{
		var file_path = base_path + files[i];
		var file = null;
		try
		{
			file = fs.readFileSync( file_path );
		}
		catch(err)
		{
			console.error((" * ERROR, file not found: " + file_path).red );
			continue;
		}
		game_code += file.toString();
	}

	//create game instance
	var instance = new GameServerInstance( game_data, game_info, port );
	instance.db = this.db;
	instance.host = this;
	instance.game_id = game_data.id;

	//instantiate server context
	try
	{
		var func = new Function( "SERVER", game_code );
		var context = new func( instance );
		game_info.class_object = context.main;
		if(!game_info.class_object)
		{
			console.error((" * ERROR, game without main constructor: " + game_type).red );
			return null;
		}
	}
	catch(err)
	{
		console.log( ("Error parsing core file: " + game_type).red );
		console.log(err);
		return null;
	}
	
	//create game main core
	try
	{
		var core = new game_info.class_object( instance );
		core.instance = instance;
		instance.core = core; //double link
		this.registerGameInstance( instance );
	}
	catch(err)
	{
		console.log( ("Error creating game core object: " + game_type).red );
		console.log(err);
		return null;
	}

	console.log( (" + Game launched: " + game_type).green );
	return instance;
}

//store game state and stop
GamesHost.prototype.actionSleepGame = function(req, resp)
{
	var that = this;

	//check login
	Users.checkKey(req, resp, function(username)
	{
		var game_id = parseInt( req.query["game_id"] );
		//check if this user can close game
		//close game
		that.db.getGameById( game_id, function( game_data ) {
			if(!game_data)
				return resp.send({status: -1, msg: "no game found with that id"});

			var instance = that.active_instances[ game_id ];
			if(!instance)
				return resp.send({status: 1, msg: "game already sleeping"});
			instance.sleep();
			return resp.send({status: 1, msg: "game slept"});
		});
	});
	
	return true;
}


GamesHost.prototype.actionPlayGame = function(req, resp)
{
	var that = this;

	//check login
	Users.checkKey(req, resp, function(username)
	{
		var game_id = parseInt( req.query["game_id"] );
		that.getOrLaunchGameInstance( game_id, function( instance ) {
			if(!instance)
				return resp.send({status: 1, msg: "game not found"});
			//console.log(instance);
			return resp.send({status: 1, msg: "game ready", info: instance.game_info, port: instance.port });
		});
	});
	
	return true;
}


//retrieve game instance, and if it is not ready, launch it
GamesHost.prototype.getOrLaunchGameInstance = function( id, callback )
{
	var that = this;

	var instance = this.active_instances[id];
	if(instance)
	{
		if(callback)
			callback(instance);
		return instance;
	}
	
	//get game data
	this.db.getGameById( id, function( game_data ) {
		if(!game_data)
		{
			if(callback)
				callback(null);
			return null;
		}
		
		var instance = that.launchGame( game_data );
		if(callback)
			callback( instance );
	});

	return null;
}

GamesHost.prototype.getGameInstance = function( id )
{
	return this.active_instances[id];
}

//called directly or from the instance event
GamesHost.prototype.sleepGame = function(id)
{
	var instance = this.getRunningInstance(id);
	if(!instance) 
		return;
	instance.sleep();
}

GamesHost.prototype.executeSafeCallback = function(instance, func_name, params)
{
	if(instance[func_name])
		return;

	try
	{
		instance[func_name].call(instance, params);
	}
	catch(err)
	{
		console.error("******************************************************".red);
		console.error("Error in game: ".red, err.toString());
		console.error(err.stack);
		console.error("******************************************************".red);
	}
}	

GamesHost.prototype.registerGameInstance = function( instance )
{
	if( this.active_instances[ instance.game_id ] )
	{
		console.error("instance already registered");
		return;
	}

	var that = this;
	this.active_instances[ instance.game_id ] = instance;
	this.num_active_instances++;
}

GamesHost.prototype.removeGameInstance = function( instance )
{
	if(!this.active_instances[ instance.game_id ])
		return console.error("game instance not found, cannot be removed");
	delete this.active_instances[ instance.game_id ];
	this.num_active_instances--;
}

GamesHost.prototype.getRunningInstance = function( id )
{
	return this.active_instances[ id ];
}

GamesHost.prototype.exit = function()
{
	console.log(" - Host exit...");
	var status = [];
	for( var i in this.active_instances )
	{
		var instance = this.active_instances[ i ];
		status.push([ instance.game_id, instance.port ] );
		instance.sleep();
	}
	
	redis.set( 'bg:host_state', JSON.stringify( status ) );
} 

module.exports = GamesHost;