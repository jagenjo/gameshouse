// GamesDB contains info about all existing games created, manages users, and game status info
// It is not in charge of running the game, only the info associated to the existing matches created
// To see the info of a running game you should go to GamesHost

var md5 = require('md5');

var redis = require('./database').redis;
var sql = require('./database').sql;

var Users = require('./users');

function GamesDB()
{
	this.host = null;
}

GamesDB.prototype.init = function( server )
{
	this.host = server.host;
}

//used for hooking events to httpd
GamesDB.prototype.registerPaths = function( express_server )
{
	express_server.get("/action/createGame", this.actionCreate.bind(this));
	express_server.get("/action/deleteGame", this.actionDelete.bind(this));
	express_server.get("/action/getGames", this.actionGetGames.bind(this));
	express_server.get("/action/getGamesStatus", this.actionGetGamesStatus.bind(this));

	express_server.get("/action/getGameAdminInfo", this.actionGetGameAdminInfo.bind(this));

	express_server.get("/action/resetGames", this.resetGames.bind(this));

	express_server.get("/action/inviteToGame", this.actionInviteToGame.bind(this));
	express_server.get("/action/kickFromGame", this.actionKickFromGame.bind(this));

	express_server.get("/action/setTitle", this.actionSetGameTitle.bind(this));
	express_server.get("/action/setTopic", this.actionSetGameTopic.bind(this));
	express_server.get("/action/sendEvent", this.actionSendEvent.bind(this));
}

//create and insert a game in the DB
GamesDB.prototype.actionCreate = function(req, resp)
{
	var that = this;
	var title = req.query["title"];
	var game = req.query["game"];
	var key = req.query["key"];

	if(!title || !game || !key)
		return  { content: { status: -1, msg: "params missing"} };

	//check user logged
	Users.isKeyValid( key, function( username )
	{
		if(!username)
			return resp.send({status: -1, msg: "invalid username"});

		var code = md5( "GAME" + (Math.random()).toString() + Date.now() );

		var query = "INSERT INTO `apps_db`.`bg_games` (`id`, `title`, `game`, `author`, `invitation_code`, `status`, `players`, `time`) VALUES (NULL, ?, ?, ?, ?, 'PLAYING', 0, CURRENT_TIMESTAMP);";

		sql().query( query, [title, game, username, code], function(err, info) {
			if (err) 
				return resp.send({status: -1, msg:"Problem creating game", err: err.toString() });
			
			var game_id = info.insertId;
			
			//insert author in game
			that.insertPlayerInGame( game_id, username, 'PLAYING', function(info){
				if (!info) 
					return resp.send({status: -1, msg:"Problem adding user to game"});
				resp.send({status: 1, msg: "game created"});
			});
			
		});
	});

	return true;
}

//delete a game from the DB
GamesDB.prototype.actionDelete = function(req, resp)
{
	var game_id = parseInt( req.query["id"] );
	var key = req.query["key"];
	var that = this;

	if(game_id == null || !key)
		return  { content: { status: -1, msg: "params missing"} };

	//check user logged
	Users.isKeyValid( key, function( username )
	{
		if(!username)
			return resp.send({status: -1, msg: "invalid username"});
			
		//sleep if it is running
		that.dispatchEventToGame( game_id, {type:"game_deleted"} );
		that.host.sleepGame(game_id);

		var query = "DELETE FROM `apps_db`.`bg_games` WHERE `bg_games`.`id` = ? AND `bg_games`.`author` = ?";
		sql().query( query, [game_id, username], function(err, info) {
			if (err) 
				resp.send({status: -1, msg:"Problem deleting game: " + err});
			else if (info.affectedRows != 1)
				resp.send({status: 1, msg: "game not found"});
			else
				resp.send({status: 1, msg: "game deleted"});
		});
		
		var query = "DELETE FROM `apps_db`.`bg_game_users` WHERE `bg_game_users`.`game_id` = ?";
		sql().query( query, [game_id] ); //blind...
		
		//delete all redis entries
		redis.keys( "bg:games:" + game_id + ":*", function(err,keys){
			
			for(var i in keys)
			{
				//console.log("removing redis key ", keys[i]);
				redis.del(keys[i]);
			}
		});
	});

	return true;
}

//get a list with all the games of this user
GamesDB.prototype.actionGetGames = function(req, resp)
{
	var that = this;
	var key = req.query["key"];
	if(!key)
		return resp.send({ content: { status: -1, msg: "params missing"} });

	Users.isKeyValid( key, function( username )
	{
		if(!username)
			return resp.send({status: -1, msg: "invalid username"});

		that.getGamesWithUser(username, function(games) {

			if (games == null) 
				resp.send({status: -1, msg:"Problem"});
			else
				resp.send({status: 1, msg:"games list", list: games});
		});
	});

	return true;
}

GamesDB.prototype.actionGetGamesStatus = function(req, resp)
{
	this.getGamesStatus(function(info) {
		if (info == null) 
			resp.send({status: -1, msg:"Problem"});
		else
			resp.send({status: 1, msg:"games status", info: info});
	});

	return true;
}

GamesDB.prototype.actionInviteToGame = function(req, resp)
{
	var that = this;
	var invited_username = req.query["username"];
	var key = req.query["key"];
	var game_id = parseInt( req.query["game_id"] );
	
	Users.isKeyValid(key, function(username) {
		if (!username)
			return resp.send({status:0, msg:"not logged in"});
		
		if (username == invited_username)
			return resp.send({status:0, msg:"cannot invite yourself"});
		
		
		//check if game belongs to user
		that.getGameById( game_id, function(game_data) {
			
			if (!game_data || game_data.author != username)
				return resp.send({status:0, msg:"wrong game"});

			//check that there is room for more players
			var game_info = that.host.games_list[ game_data.game ];
			var max_players = game_info.max_players;
			if( game_data.players >= max_players )
				return resp.send({status: -1, msg:"Game is full, no more players allowed"});

			//find user
			Users.getUserInfo( invited_username, function(user_data){
				if(!user_data)
					return resp.send({status:0, msg:"user "+invited_username+" not found"});

				var game_id = game_data.id;
				that.isPlayerInGame(invited_username,game_id, function(v) {
					if (v) {
						return resp.send({status:0, msg:"player already in this game"});
					}
					
					//send invitation
					that.insertPlayerInGame( game_id, invited_username, 'INVITED', function(info){
						if (!info) 
							return resp.send({status: -1, msg:"Problem adding user to game"});
						resp.send({status: 1, msg: "user invited"});
					});
				});
			});
		});			
	});
	
	return true;
}

GamesDB.prototype.actionKickFromGame = function(req, resp)
{
	var that = this;
	var kicked_username = req.query["username"];
	var key = req.query["key"];
	var game_id = parseInt( req.query["game_id"] );
	
	Users.isKeyValid(key, function(username) {
		if (!username)
			return resp.send({status:0, msg:"not logged in"});
		
		//check if game belongs to user
		that.getGameById( game_id, function(game_info) {
			
			if (!game_info || (game_info.author != username && username != kicked_username) )
				return resp.send({status:0, msg:"wrong game"});
			
			//find user
			Users.getUserInfo(kicked_username, function(user_data){
				if(!user_data)
					return resp.send({status:0, msg:"user "+kicked_username+" not found"});

				var game_id = game_info.id;
				that.isPlayerInGame(kicked_username,game_id, function(v) {
					if (!v) {
						return resp.send({status:0, msg:"player not in this game"});
					}
					
					//send invitation
					that.removePlayerFromGame(game_id, kicked_username, function(info){
						if (!info) 
							return resp.send({status: -1, msg:"Problem removing user from game"});
						resp.send({status: 1, msg: "user removed from game"});
					});
				});
			});
		});			
	});
	
	return true;
}	

GamesDB.prototype.actionGetGameAdminInfo = function(req, resp)
{
	var key = req.query["key"];
	var game_id = parseInt( req.query["game_id"] );
	var that = this;
	
	Users.isKeyValid(key, function(username) {
		if (!username)
			return resp.send({status:0, msg:"not logged in"});

		//HACK with a racing condition to fetch in paralel
		var logkey = "bg:games:" + game_id + ":log";
		var log_lines = null;
		redis.lrange( logkey, -20, -1, function(err,val){
			log_lines = val;
		});

		//check if game belongs to user, returns SQL entry for the game
		that.getGameById( game_id, function( game_data ) {

			if (!game_data || (game_data.author != username ) )
				return resp.send({ status:0, msg:"wrong game" });

			var instance = that.host.getRunningInstance( game_id );
			var online_players = null;
			if(instance)
			{
				game_data.port = instance.port;
				online_players = {};
				game_data.running = true;
				for(var i = 0; i < instance.clients.length; ++i)
				{
					online_players[ instance.clients[i].username ] = true;
				}
			}

			//console.log(game_data);
			game_data.panel = game_data.game_info.panel ? (game_data.game_info.launch + "/" + game_data.game_info.panel) : null;

			//retrieve all player that joined this game
			that.getPlayersInGame( game_id, function( users ) {
				return resp.send({ status: 1, info: game_data, users: users, online_players: online_players, log: log_lines });
			});
		}, true);			
	});
	
	return true;
}

GamesDB.prototype.actionSetGameTitle = function(req, resp)
{
	var key = req.query["key"];
	var game_id = parseInt( req.query["game_id"] );
	var title = req.query["title"];
	var that = this;
	
	Users.isKeyValid(key, function(username) {
		if (!username)
			return resp.send({status:0, msg:"not logged in"});

		that.getGameById( game_id, function(game_data){

			if (!game_data || (game_data.author != username ) )
				return resp.send({ status:0, msg:"wrong game" });

			that.updateGameField( game_id, "title", title, function(){
				return resp.send({ status:1, msg:"title changed", title: title });
			});
		});
	});
	
	return true;
}

GamesDB.prototype.actionSetGameTopic = function(req, resp)
{
	var key = req.query["key"];
	var game_id = parseInt( req.query["game_id"] );
	var topic = req.query["topic"];
	var that = this;
	
	Users.isKeyValid(key, function(username) {
		if (!username)
			return resp.send({status:0, msg:"not logged in"});

		that.getGameById( game_id, function(game_data){

			if (!game_data || (game_data.author != username ) )
				return resp.send({ status:0, msg:"wrong game" });

			that.updateGameField( game_id, "topic", topic, function(){
				return resp.send({ status:1, msg:"topic changed", topic: topic });
			});
		});
	});
	
	return true;
}

GamesDB.prototype.actionSendEvent = function(req, resp)
{
	var key = req.query["key"];
	var game_id = parseInt( req.query["game_id"] );

	var event;
	try
	{
		event = JSON.parse( req.query["event"] );
	}
	catch (err)
	{
		console.error("error parsing event json");
		return;
	}
	var that = this;
	
	Users.isKeyValid(key, function(username) {
		if (!username)
			return resp.send({status:0, msg:"not logged in"});

		that.getGameById( game_id, function(game_data){

			if (!game_data || (game_data.author != username ) )
				return resp.send({ status:0, msg:"wrong game" });

			var instance = that.host.getRunningInstance( game_id );
			if(!instance)
				return resp.send({ status:0, msg:"game is not running" });

			that.sendEventToGame( game_id, event, function(event_response){
				return resp.send({ status:1, msg:"event sent", event_response: event_response});
			});
		});
	});
	
	return true;
}


//retrieves game info from the DB
GamesDB.prototype.getGameById = function( id, callback, include_game_info )
{
	var that = this;
	var query = "SELECT * FROM `apps_db`.`bg_games` WHERE id = ?";
	sql().query( query, [id], function(err, rows, fields) {
		if (err) 
		{
			callback(null);
			return;
		}
		var data = rows[0];
		if(include_game_info)
			data.game_info = that.host.games_list[ data.game ];
		callback(data);
	});
}

GamesDB.prototype.getGamesCreatedByUser = function(username, callback)
{
	var host = this.host;
	var query = "SELECT * FROM `apps_db`.`bg_games` WHERE author = ?";
	sql().query( query, [username], function(err, rows, fields) {
		if (err) 
			return callback(null);

		for(var i in rows)
		{
			rows[i].running = host.getRunningInstance( rows[i].id ) ? true : false;
		}
		
		callback(rows);
	});
}

//returns a list with all the games that have this user
GamesDB.prototype.getGamesWithUser = function( username, callback )
{
	var host = this.host;

	var query = "SELECT `bg_games`.*, `bg_game_users`.status AS user_status FROM `bg_games`,`bg_game_users` WHERE `bg_games`.`id` = `bg_game_users`.`game_id` AND `bg_game_users`.username = ?";
	sql().query( query, [username], function(err, rows, fields) {
		if (err)
		{
			if (callback)
				callback(null);
			return;
		}

		//process data
		for(var i in rows)
		{
			var game_id = rows[i].id;
			rows[i].is_admin = rows[i].author == username;
			rows[i].running = host.getRunningInstance( game_id ) ? true : false;
		}
		
		if (callback)
			callback(rows);
		
		/*
		var query = "SELECT game_id, COUNT(username) AS players FROM `bg_game_users` WHERE game_id = ? GROUP BY (game_id)";
		sql().query( query, [username], function(err, users_rows) {
		});
		*/
	});
}

//gets info to show in the dashboard
//async
GamesDB.prototype.getGamesStatus = function( callback )
{
	var info = {}
	var host = this.host;
	
	var query = "SELECT COUNT(*) AS numgames FROM `apps_db`.`bg_games` ";
	sql().query( query, [], function(err, rows, fields) {
		if (err) 
			return callback(null);
		
		info["Games created"] = rows[0].numgames;
		info["Games running"] = host.num_active_instances;
		callback(info);
	});		
}

//async
GamesDB.prototype.getPlayersInGame = function( game_id, callback )
{
	var query = "SELECT * FROM `apps_db`.`bg_game_users` WHERE `game_id` = ?";
	sql().query( query, [game_id], function(err, rows) {
		if (err) 
			return callback(null);
		
		var users = [];
		for(var i in rows)
		{
			var user = rows[i];
			users.push(user);
		}
		
		callback(users);
	});		
}

//async
GamesDB.prototype.isPlayerInGame = function(username, game_id, callback)
{
	var query = "SELECT * FROM `bg_game_users` WHERE username = ? AND game_id = ?";
	sql().query( query, [username, game_id], function(err, rows) {
		
		if (err) {
			console.error("Error reading if player is in game");
			callback(false);
			return;
		}
		if (rows && rows.length > 0)
			return callback(true);
		callback(false);
	});
}

//async
GamesDB.prototype.insertPlayerInGame = function( game_id, username, state, callback)
{
	var that = this;

	//get players
	var players = this.getPlayersInGame( game_id, function(players) {

		//search first empty index
		var index = 0;
		console.log( JSON.stringify(players) );
		for( var i = 0; i < players.length; ++i )
		{
			var player_index = players[i].index;
			if( index == player_index )
			{
				index++;
				i = 0;
			}
		}
	
		//increase players
		var query = "UPDATE  `apps_db`.`bg_games` SET `players` = `players` + 1 WHERE  `bg_games`.`id` = ?";
		sql().query( query, [game_id], function(err, info) {
			if (err) {
				if(callback)
					callback(null);
			}
			
			if (info.changedRows != 1)
				console.error("Error increasing players in game, no changes in sql");

			//create user in game_users table
			var query = "INSERT INTO `apps_db`.`bg_game_users` (`id`, `username`, `game_id`, `status`, `index`, `score`, `status`, `time`) VALUES (NULL, ?, ?, ?, ?, 0, '', CURRENT_TIMESTAMP)";
			sql().query( query, [ username, game_id, state, index ], function(err, info) {

				that.dispatchEventToGame( game_id, {type:"new_player", username: username} );
				if (callback)
					callback(err ? null : info);
			});
		});
	
	
	});
}

//async
GamesDB.prototype.removePlayerFromGame = function( game_id, username, callback )
{
	var that = this;
	//delete user in game_users table
	var query = "DELETE FROM `apps_db`.`bg_game_users` WHERE `username` = ? AND `game_id` = ?";
	sql().query( query, [username, game_id], function(err, info) {

		if (err || info.affectedRows != 1) {
			if(callback)
				callback(null);
		}

		//decreaseplayers
		var query = "UPDATE `apps_db`.`bg_games` SET `players` = `players` - 1 WHERE  `bg_games`.`id` = ?";
		sql().query( query, [game_id], function(err, info) {
			if (err) {
				if(callback)
					callback(null);
			}
			
			if (info.changedRows != 1)
				console.error("Error increasing players in game, no changes in sql");
				
			that.dispatchEventToGame( game_id, {type:"player_leave", username: username} );

			if (callback)
				callback(err ? null : info);
		});
	});
}

GamesDB.prototype.setPlayerField = function( game_id, username, field, value, callback )
{
	var that = this;
	if(field != 'score' && field != 'info' && field != 'status')
	{
		console.error("setPlayerField field is not valid");
		return;
	}

	//delete user in game_users table
	var query = "UPDATE `apps_db`.`bg_game_users` SET `"+field+"` = ? WHERE `username` = ? AND `game_id` = ?";
	sql().query( query, [value, username, game_id], function(err, info) {
		if (err || info.affectedRows != 1) {
			if(err)
				console.error(err.sqlMessage);
			if(callback)
				callback(null);
			return;
		}
		console.log("update: ", info.affectedRows);
			if(callback)
				callback(true);
	});
}


GamesDB.prototype.dispatchEventToGame = function( game_id, event, callback )
{
	var instance = this.host.getRunningInstance( game_id );
	//instance running?
	if (instance) {
		instance.dispatchEvent("system", event);
		return;
	}
	
	//the game is sleeping, then add to queue
	var str = JSON.stringify(event);
	redis.rpush("bg:games:" + game_id + ":events", str);
}

GamesDB.prototype.updateGameField = function( id, field, value, callback )
{
	var that = this;
	if(field != "topic" && field != "title" )
		return;

	var query = "UPDATE  `apps_db`.`bg_games` SET  `"+field+"` = ? WHERE  `bg_games`.`id` = ?;";
	sql().query( query, [value, id], function(err, rows, fields) {
		//console.log(err,rows);
		var instance = that.host.getRunningInstance( id );
		if(instance)
			instance.dispatchEvent( "change", { field: field, value: value } );
		if(callback)
			callback( !err, err );
	});
}

GamesDB.prototype.sendEventToGame = function( id, event, callback )
{
	var instance = this.host.getRunningInstance( id );
	if(!instance)
	{
		console.log("error: sending event to instance that is not running");
		return;
	}

	if(event.type == "command")
		instance.log( "] " + event.data );

	var r = instance.dispatchEvent( "event", event );
	if(callback)
		callback(r);
	return r;
}

//create the table for games
GamesDB.prototype.resetGames = function(req, resp)
{
	//clear Redis
	redis.keys( "bg:games:*", function(err,keys){
		for(var i in keys)
			redis.del(keys[i]);
	});

	//clear DB
	var queries = [];

	queries.push( "DROP TABLE IF EXISTS `bg_games`;" );
	queries.push( "DROP TABLE IF EXISTS `bg_game_users`;" );

	queries.push( "CREATE TABLE IF NOT EXISTS `bg_games` (`id` int(10) unsigned NOT NULL AUTO_INCREMENT,`title` varchar(64) NOT NULL,"+
				 "`game` varchar(64) NOT NULL," +
				 "`author` varchar(32) NOT NULL, "+
				 "`status` enum('DRAFT','WAITING','PLAYING','PAUSED','FINISHED') NOT NULL, "+
				 "`topic` varchar(256) NOT NULL," +
				 "`players` int(10) NOT NULL," +
				 "`invitation_code` varchar(64) NOT NULL," +
				 "`time` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP, "+
				 " PRIMARY KEY (`id`) " +
				") ENGINE=InnoDB DEFAULT CHARSET=latin1 AUTO_INCREMENT=1 ;" );
				
	queries.push( "CREATE TABLE IF NOT EXISTS `bg_game_users` ("+
				"`id` int(11) NOT NULL AUTO_INCREMENT,"+
				"`username` varchar(64) NOT NULL,"+ //username because we do not have an id per user
				"`info` varchar(64) NOT NULL,"+ //something about this player in this game
				"`game_id` int(11) NOT NULL,"+
				"`index` int(11) NOT NULL,"+ //index of player inside game (like player position)
				"`score` int(11) NOT NULL,"+ //score of player 
				"`time` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,"+
				"`status` enum('INVITED','PLAYING','ABANDONED','BANNED') NOT NULL,"+
				"PRIMARY KEY (`id`) "+
				") ENGINE=InnoDB DEFAULT CHARSET=latin1 AUTO_INCREMENT=1 ;");
				
	var errors = 0;

	sql().query( queries.shift(), queryResult);
	return true;

	function queryResult(err, info)
	{
		if (err)
		{
			console.error(err);
			if (!resp)
				return console.error("Restart Error" + err.toString());
			return resp.send({status: -1, msg:"Problem creating table"});
		}
		else
			console.log(" + Query executed" );

		if (queries.length) {
			sql().query( queries.shift(), queryResult);
			return;
		}
		
		if (resp)
			resp.send({status: 1, msg: "table created"});
		
	}
}


module.exports = GamesDB;
