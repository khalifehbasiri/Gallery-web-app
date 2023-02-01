import fs from "fs";
import path from "path";

// list of all galleries
let galleries = [];
//Array of registered users.
const users = [
	{'username':'khalifa', 'password':'yes', 'aType':'patron'},
    {'username':'Corrine Hunt', 'password':'no', 'aType':'artist'},
	{'username':'Luke', 'password':'no', 'aType':'artist'},
	{'username':'Anatoliy Kushch', 'password':'no', 'aType':'artist'},
	{'username':'Lea Roche', 'password':'no', 'aType':'artist'},
	{'username':'Jim Dine', 'password':'no', 'aType':'artist'},
	{'username':'Shari Hatt', 'password':'no', 'aType':'artist'},
	{'username':'Sebastian McKinnon', 'password':'no', 'aType':'artist'},
	{'username':'Kimika Hara', 'password':'no', 'aType':'artist'},
	{'username':'Keith Mallett', 'password':'no', 'aType':'artist'},
	{'username':'ArtMind', 'password':'no', 'aType':'artist'},
	{'username':'Midjourney', 'password':'no', 'aType':'artist'}
];

// traverse thru json files and add them to temp
let temp = [];
const files = fs.readdirSync('./JSON').filter(file => path.extname(file) === '.json');
files.forEach(file => {
  const fileData = fs.readFileSync(path.join('./JSON', file));
  const json = JSON.parse(fileData.toString());
  temp.push(json);
});

temp.forEach(elem => {
    elem.forEach(elem1 => {
        galleries.push(elem1);
    })
})

//Import the mongoose module.
import pkg from 'mongoose';

const { connect, connection } = pkg;

//Import the user and gallery models.
import User from './UserModel.js';
import Gallery from './galleriesModel.js';

//Create an async function to load the data.
//Other mongoose calls that return promises(connect, dropdatabase, create) 
//inside the async function can use an await.
const loadData = async () => {
	
	//Connect to the mongo database.
  	await connect('mongodb://localhost:27017/TP');

	//Remove database and start anew.
	await connection.dropDatabase();
	
	//Map each registered user object into the a new User model.
	let access = users.map( aUser => new User(aUser));

	let gallery = galleries.map( gal => new Gallery(gal));

	//Creates a new documents of a citizen and user and saves
	//it into the citizens and users collections.
	await User.create(access);
	await Gallery.create(gallery);
}

//Call to load the data.
//Once the loadData Promise returns it will close the database
//connection.  Any errors from connect, dropDatabase or create
//will be caught in the catch statement.
loadData()
  .then((result) => {
	console.log("Closing database connection.");
 	connection.close();
  })
  .catch(err => console.log(err));