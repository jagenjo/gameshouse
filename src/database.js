//STATIC access to DBs

function puts(error, stdout, stderr) { sys.puts(stdout) }

//REDIS DB *********************************
var redis = require("redis"),
    client = redis.createClient();
	client.select(1); //DB 1

client.on("error", function (err) {
    console.log("error event - " + client.host + ":" + client.port + " - " + err);
});

/* example
client.set("string key", "string val", redis.print);

client.get("missingkey", function(err, reply) {
    // reply is null when the key is missing
    console.log(reply);
});

client.get("BGGAME:12:data:tick",console.log);

*/


exports.redis = client;

//MYSQL DB ***********************************
var mysql      = require('mysql');
var connection = null;

/*
connection.query('SELECT 1 + 1 AS solution', function(err, rows, fields) {
  if (err) throw err;
  console.log('The solution is: ', rows[0].solution);
});

connection.end();
*/

exports.sql = function() { return connection };

// GLOBAL *******************
exports.init = function init( config )
{
	if(!config.sql)
	{
		console.warn("no SQL config found");
		return;
	}
	connection = mysql.createConnection( config.sql );
	connection.connect();

	console.log(" + DB ready");

	function keepalive() {
	  connection.query('select 1', [], function(err, result) {
		if(err) return console.log(err);
		// Successul keepalive
	  });
	}
	setInterval( keepalive, 1000*60*5 ); //keep alive to avoid 8 hours idle disconnection
}

exports.exit = function exit() 
{
	console.log(" - DB exit");
	connection.end();
}