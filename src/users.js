//static class

var crypto = require('crypto'); //for salting
var exec = require('child_process').exec; //to call mail process
var sys = require('util');
var redis = require('./database').redis;
var sql = require('./database').mysql;
var check = require('validator');

var Users = {
	salt: null,
	users: {},
	
	init: function( server, config )
	{
		if(this.salt) //called twice, because Users is a module
			return;

		this.salt = config.salt || "RANDOM STRING VERY LONG AND VERY TIPICAL with all kinds of character";
		console.log( " + Users ready ");
	},

	registerPaths: function( express_server )
	{
		express_server.get("/action/login", this.actionLogin.bind(this));
		express_server.get("/action/login/check", this.actionCheckKey.bind(this));
		express_server.get("/action/logout", this.actionLogout.bind(this));
		express_server.get("/action/signup", this.actionCreateUser.bind(this));
	},

	actionLogin: function(req, resp)
	{
		var username = req.query.user;
		var password = req.query.pass;

		if(!username || !password)
		{
			console.log("error: action login with empty fields");
			resp.send({status: -1, msg: "params missing" });
			return true;
		}
		
		//validate username
		username = username.toLowerCase();

		//get user info
		Users.getUserInfo(username, function(user_data){
			if(!user_data)
				return resp.send({status:0, msg:"not found"});

			var str = user_data["salt"] + password;
			var hash = crypto.createHash('md5').update( str ).digest('hex');
			if(hash != user_data["pass"])
			{
				//Login.mailToUser(user,"Warning","Somebody wants to enter in your Moregames account");
				return resp.send({status:-1, msg:"wrong pass"});
			}

			redis.get("bg:user:" + username + ":session", function(err,reply) {
				var session_key = null;
				if(!reply) //create new session key
					session_key = Users.createSessionKey(username);
				else
					session_key = reply;

				resp.send({status: 1, username: username, key: session_key });
			});
		});

		return true;
	},

	actionCheckKey: function(req, resp)
	{
		var key = req.query.key;
		redis.get("bg:session:" + key, function(err,username) {
			if(!username)
				return resp.send({status:0, msg:"no session found" });

			//check that the user exists
			redis.get("bg:user:" + username, function(err,reply) {
				if(reply)
					resp.send({status:1, username: username });
				else
					resp.send({status:-1, msg:"error?" });
			});
		});

		return true;
	},

	actionLogout: function(req, resp)
	{
		var key = req.query.key;
		redis.get("bg:session:" + key, function(err,username) {
			if(!username)
				return resp.send({status:0, msg:"no session found" });

			redis.del("bg:session:" + key);
			redis.del("bg:user:" + username + ":session");
			resp.send({status:1, msg:"logged out" });
		});

		return true;
	},
	
	actionCreateUser: function(req, resp)
	{
		var username = req.query["username"];
		var mail = req.query["mail"];
		var password = req.query["password"];
		
		if (!username || !mail || !password)
			return {content:{status:-1, msg:"params missing"}};
		
		username = username.toLowerCase();

		if( !check.isEmail(mail) )
			return {content:{status:-1, msg:"wrong email address"}};
		
		//check if user already with this username
		redis.get("bg:user:" + username, function(err,reply) {
			if(reply)
				return resp.send({status:-1, msg:"user found with this name"});
			
			redis.get("bg:usermail:" + mail, function(err,reply) {
				if(reply)
					return resp.send({status:-1, msg:"user found with this mail"});
				
				Users.createUser(username, password, mail);
				var session_key = Users.createSessionKey(username);
				resp.send({status:1, msg:"user created", key: session_key});
			});
		});
		return true;
	},
	
	createSessionKey: function( username )
	{
		username = username.toLowerCase();
		
		var str = new Date().getTime().toString() + Math.random().toString() + username;
		var session_key = crypto.createHash('md5').update( str ).digest('hex');

		//store		
		redis.set("bg:session:" + session_key, username);
		redis.set("bg:user:" + username + ":session", session_key);
		
		//keys last one month
		redis.expire("bg:session:" + session_key, 60*60*24*30 );
		redis.expire("bg:user:" + username + ":session", 60*60*24*30 );
		
		return session_key;
	},
	
	createUser: function(username, password, mail)
	{
		username = username.toLowerCase();
		
		var salt = Math.random().toString();
		var str = salt + password;
		var hash = crypto.createHash('md5').update( str ).digest('hex');		
		
		var data = {
			role:"user",
			salt: salt,
			pass: hash,
			mail: mail
		};
		
		redis.set("bg:user:" + username, JSON.stringify(data));
		redis.set("bg:usermail:" + mail, username);
		
		this.mailToUser(username,"Welcome to GamesHouse","You have been registered to GamesHouse.\nPlease, <a href=''>click here</a> to confirm your registration.");
		
		return true;
	},
	
	deleteUser: function(username, callback)
	{
		username = username.toLowerCase();
		
		redis.get("bg:user:" + username, function(err,reply) {
			if(!reply)
			{
				//user not found
				if (callback)
					callback(false);
				return;
			}
			
			var user_data = JSON.parse(reply);
			redis.del("bg:usermail:" + user_data.mail );
			redis.del("bg:user:" + username);
			
			//remove session
			redis.get("bg:user:" + username + ":session", function(err, reply){
				if (reply)
					redis.del("bg:session:" + reply);
			});
			
			//remove user data
			redis.keys( "bg:user:" + username + ":*", function(err,keys) {
							
				for(var i in keys)
				{
					//console.log("removing redis key ", keys[i]);
					redis.del(keys[i]);
				}
			});
			
			//remove games created by user
			var query = "DELETE FROM `apps_db`.`bg_games` WHERE `bg_games`.`author` = ?";
			sql.query( query, [username], function(err, rows, fields) {
				if (err) 
					console.error("Problem deleting games: " + err);
			});
			
			if (callback)
				callback(true);
		});
	},
	
	getUserInfo: function(username, callback)
	{
		username = username.toLowerCase();
		
		//get user info
		redis.get("bg:user:" + username, function(err,reply) {
			if(!reply)
			{
				if (callback)
					callback(null);
				return;
			}

			var user_data = JSON.parse(reply);
			if (callback)
				callback(user_data);
		});		
	},

	//sends username if the key is valid, otherwise false
	isKeyValid: function(key, callback)
	{
		redis.get("bg:session:" + key, function(err,username) {
			if(!username)
				return callback(false);

			//check that the user exists
			redis.get("bg:user:" + username, function(err,reply) {
				if(reply)
					return callback(username);
				callback(false);
			});
		});
	},
	
	checkKey: function(req, resp, on_valid)
	{
		var key = req.query["key"];
		if(!key)
		{
			resp.send({status: 1, msg: "no key found in request"});
			return;
		}		

		//check user logged
		Users.isKeyValid( key, function( username )
		{
			if(!username)
			{
				resp.send({status: 1, msg: "no user logged"});
				return;
			}
			
			if(on_valid)
				on_valid(username);
		});
	},

	mailToUser: function(username, subject, msg)
	{
		username = username.toLowerCase();
		
		redis.get("bg:user:" + username, function(err,reply) {
			if(!reply)
				return;
			var userdata = JSON.parse(reply);
			if(!userdata.mail) return;
			
			function puts(error, stdout, stderr) { sys.puts(stdout) }

			var cmd = "echo \""+msg+"\" | mailx -a 'Content-Type: text/html' -s \""+subject+"\" " + userdata.mail;
			exec(cmd, puts);
			console.log("mail sent to: " + userdata.mail);
		});
	}
};


module.exports = Users;
