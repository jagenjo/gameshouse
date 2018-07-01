

//load config
var config_path = '../config.json';
var fs = require('fs');
var config_data = fs.readFileSync( config_path, 'utf8');
if( !config_data )
{
	console.error("no config.json found");
	process.exit();
	return;
}

var config = JSON.parse( config_data );

console.log("GamesHouse init ... " );

//launch
var GamesHouse = require('./gamesHouse');
console.log(" version " + GamesHouse.version );

var gameshouse_server = new GamesHouse.Server( config );
gameshouse_server.start( 8081 );

//close 
function cleanExit(v,v2) {
	//close the app alerting all modules
	gameshouse_server.close(function () { 
		console.log('exiting...');
		process.exit();
		//process.kill(process.pid, 'SIGUSR2'); 
	});
}

//nodemon signal for closing
process.once('SIGUSR2', cleanExit );
