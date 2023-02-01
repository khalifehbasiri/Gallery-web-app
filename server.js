import express from 'express';
import mongo from 'mongodb';

const app = express();

import session from 'express-session';
import { default as connectMongoDBSession} from 'connect-mongodb-session';

const MongoDBStore = connectMongoDBSession(session);

//Defining the location of the sessions data in the database.
var store = new MongoDBStore({
  uri: 'mongodb://localhost:27017/TP',
  collection: 'sessions'
});

//Setting up the express sessions to be stored in the database.
app.use(session(
    { 
      secret: 'top secret key',
      resave: true,
      saveUninitialized: false,
      store: store 
    })
);

//Request logger.
import logger from 'morgan'; 

import pkg from 'mongoose';
const { connect, Types } = pkg;

app.use(express.urlencoded({extended: true}));

//Import User models.
import User from './UserModel.js';
import Gallery from './galleriesModel.js';

//process.env.PORT will see if there is a specific port set in the environment.
const PORT = process.env.PORT || 3000;

 //Root directory for javascript files.
const ROOT_DIR_JS = '/public';

// Change the host to localhost if you are running the server on your
// own computer.
let host = ["localhost", "YOUR_OPENSTACK_IP"];

//Static server will check the following directory.
//Needed for the addPerson, deletePerson and register javascript files.
app.use(express.static("." + ROOT_DIR_JS));

//Convert any JSON stringified strings in a POST request to JSON.
app.use(express.json());

//Setting pug as our template engine.
app.set('views', './views');
app.set('view engine', 'pug');

//global
let search = [];

//This get method has two endpoints going to the same rendered pug file
app.get(['/', '/home'], async(req, res) => {

	res.status(200).render('pages/home', { session: req.session });

});



// Rendering the registration page.
app.get("/register", (req, res) => {

	res.status(200).render("pages/register", { session: req.session });
     
});

// Saving the user registration to the database.
app.post("/register", async (req, res) => {

    let newUser = req.body;

    try{
        const searchResult = await User.findOne({ username: newUser.username});
        if(searchResult == null) {
            console.log("registering: " + JSON.stringify(newUser));
            await User.create(newUser);
            res.status(200).send();
        } else {
            console.log("Send error.");
            res.status(404).json({'error': 'Exists'});
        }
    } catch (err) {
        console.log(err);
        res.status(500).json({ error: "Error registering" });
    }  

});

// Search the database to match the username and password .
app.post("/login", async (req, res) => {

	let username = req.body.username;
	let password = req.body.password;

    try {
        const searchResult = await User.findOne({ username: username });
        if(searchResult != null) { 
            if(searchResult.password === password) {
                // If we successfully match the username and password
                // then set the session properties.  We add these properties
                // to the session object.
                req.session.loggedin = true;
                req.session.username = searchResult.username;
                req.session.userid = searchResult._id;
                res.status(200).render('pages/home', { session: req.session })
            } else {
                res.status(401).send("Not authorized. Invalid password.");
            }
        } else {
            res.status(401).send("Not authorized. Invalid password.");
        }
    } catch(err) {
        console.log(err);
        res.status(500).json({ error: "Error logging in."});
    }    

});

// Log the user out of the application.
app.get("/logout", (req, res) => {

    // Set the session loggedin property to false.
	if(req.session.loggedin) {
		req.session.loggedin = false;
	}
	res.status(200).redirect(`http://${host[0]}:3000/home`);

});


//This get method has two endpoints going to the same rendered pug file
app.get("/account", async (req, res) => {
    const searchResult = await User.findOne({ username: req.session.username });
    const searchResult1 = await Gallery.find({"artist": req.session.username });
	res.status(200).render('pages/account', { session: req.session, user: searchResult , art:searchResult1});
});

app.get('/searchArt', async(req, res) => {
    let searchResult1 = await User.findOne({"username": req.session.username});
	res.status(200).render('pages/searchArt', { session: req.session, user: searchResult1, art: search });
});

app.post('/searchArt', async(req, res) => {
    let temp = req.body;
    let searchResult = [];
    if (temp != {}){
        searchResult = await Gallery.find({$and:[temp]});
    }
    search = searchResult;
});

app.post("/accType", async (req, res)=>{
    let x = req.body.value;

    try {
        if (x == "patron"){
            const searchResult = await User.updateOne({"username": req.session.username}, {$set: {"aType": "artist"}});
        }else {
            const searchResult = await User.updateOne({username: req.session.username}, {$set: {"aType": "patron"}});
        }
    } catch(err) {
        console.log(err);
        res.status(500).json({ error: "Error updating."});
    }
})


// get followed artist
app.get("/artist/:id", async (req, res) => {
    let oid;
	try{
		oid = new mongo.ObjectId(req.params.id);
	}catch{
		res.status(404).send("Unknown ID");
		return;
	}

    try {
        const searchResult = await User.findOne({"_id":oid});
        const searchResult1 = await Gallery.find({"artist":searchResult.username});
        const searchResult2 = await User.findOne({"username": req.session.username});
	    res.render('pages/fAccount', { session: req.session, user: searchResult2, followed: searchResult , art: searchResult1});
    } catch(err) {
        console.log(err);
        res.status(500).json({ error: "Error getting user."});
    }
});

// get followed artist
app.get("/art/:id", async (req, res) => {
    let oid;
	try{
		oid = new mongo.ObjectId(req.params.id);
	}catch{
		res.status(404).send("Unknown ID");
		return;
	}

    try {
        const searchResult = await User.findOne({"username": req.session.username});
        const searchResult1 = await Gallery.findOne({"_id":oid});
        const searchResult2 = await User.findOne({"username":searchResult1.artist});
	    res.render('pages/art', { session: req.session, user: searchResult, art: searchResult1, artist: searchResult2});
    } catch(err) {
        console.log(err);
        res.status(500).json({ error: "Error getting user."});
    }
});


// get artwork
app.get("/artwork", async (req, res) => {
    try {
        const searchResult = await User.findOne({"username": req.session.username});
        const searchResult1 = await Gallery.find({});
        let temp = searchResult1.sort(function () {
            return Math.random() - 0.5;
        });
	    res.render('pages/artwork', { session: req.session, user: searchResult, art: temp});
    } catch(err) {
        console.log(err);
        res.status(500).json({ error: "Error getting user."});
    }
});


// unfollow artist
app.post("/unfollow", async (req, res) => {
    let x = req.body.value;

    try {
        const searchResult = await User.findOne({"username":req.session.username});
        let temp = searchResult.following;
        let i = 0;
        temp.forEach(elem => {
            if (elem.username == x){
                temp.splice(i, 1);
            }
            i++;
        })
        const searchResult1 = await User.updateOne({ username: req.session.username}, {$set: {"following": temp}});

    } catch(err) {
        console.log(err);
        res.status(500).json({ error: "Error getting user."});
    }
});

// follow artist
app.post("/follow", async (req, res) => {
    let id = req.body.value;
    let oid;
    try{
        oid = new mongo.ObjectId(id);
    }catch{
        res.status(404).send("Unknown ID");
        return;
    }

    try {
        const searchResult = await User.findOne({"username": req.session.username});
        const searchResult1 = await User.findOne({"_id":oid});

        let temp = searchResult.following;
        let i = 0;
        temp.forEach(elem => {
            if (elem.username == searchResult1.username){
                i++;
            }
        })
        if (i == 0){
            (temp).push(searchResult1);
        }

        const searchResult2 = await User.updateOne({ username: req.session.username}, {$set: {"following": temp}});

        const searchResult3 = await User.findOne({"username":req.session.username});

    } catch(err) {
        console.log(err);
        res.status(500).json({ error: "Error getting user."});
    }
});

app.post("/like", async (req, res) => {
    try {
        let x = req.body.value;
        let oid;
        try{
            oid = new mongo.ObjectId(x);
        }catch{
            res.status(404).send("Unknown ID");
            return;
        }
    
        const searchResult = await User.findOne({"username": req.session.username});
        let temp = searchResult.like;
        const searchResult1 = await Gallery.findOne({"_id":oid});

        let i = 0;
        temp.forEach(elem => {
            if (searchResult1 == elem){
                i++;
            }
        })
        if (i == 0){
            temp.push(searchResult1);
        }
        searchResult1.numLikes.push("like");
        const searchResult3 = await User.updateOne({ username: req.session.username}, {$set: {"like": temp}});
        const searchResult4 = await Gallery.updateOne({"_id":oid}, {$set: {"numLikes": searchResult1.numLikes}});
    } catch(err) {
        console.log(err);
        res.status(500).json({ error: "Error getting user."});
    }
});

app.post("/unlike", async (req, res) => {
    try {
        let x = req.body.value;
        let oid;
        try{
            oid = new mongo.ObjectId(x);
        }catch{
            res.status(404).send("Unknown ID");
            return;
        }
        
        const searchResult = await User.findOne({"username": req.session.username});
        let temp = searchResult.like;
        const searchResult1 = await Gallery.findOne({"_id":oid});

        let i = 0;
        temp.forEach(elem => {
            if (searchResult1.name == elem.name){
                temp.splice(i, 1);
            }
            i++;
        })

        searchResult1.numLikes.splice(0,1);
        const searchResult3 = await User.updateOne({ username: req.session.username}, {$set: {"like": temp}});
        const searchResult4 = await Gallery.updateOne({"_id":oid}, {$set: {"numLikes": searchResult1.numLikes}});
    } catch(err) {
        console.log(err);
        res.status(500).json({ error: "Error getting user."});
    }
});



app.post("/rsubmit", async (req, res) => {
    try {
        let x = req.body.value;
        let y = req.body.id;

        let oid;
        try{
            oid = new mongo.ObjectId(y);
        }catch{
            res.status(404).send("Unknown ID");
            return;
        }
    
        const searchResult = await User.findOne({"username": req.session.username});
        const searchResult1 = await Gallery.findOne({"_id":oid});

        let temp1 = {
            user: searchResult.username,
            userId: searchResult._id,
            review: x
        };

        let temp2 = {
            art: searchResult1.artist,
            artId: searchResult1._id,
            review: x
        };

        (searchResult.reviews).push(temp2);
        (searchResult1.reviews).push(temp1);
        
        const searchResult2 = await Gallery.updateOne({ _id: oid}, {$set: {"reviews": searchResult1.reviews}});
        const searchResult3 = await User.updateOne({"username": req.session.username}, {$set: {"reviews": searchResult.reviews}});
        
    } catch(err) {
        console.log(err);
        res.status(500).json({ error: "Error getting user."});
    }
});


app.post("/rRemove", async (req, res) => {
    try {
        let x = req.body.value;
        let y = req.body.id;

        let oid;
        try{
            oid = new mongo.ObjectId(y);
        }catch{
            res.status(404).send("Unknown ID");
            return;
        }
        
        const searchResult = await User.findOne({"username": req.session.username});
        const searchResult1 = await Gallery.findOne({"_id":oid});

        let temp1 = searchResult.reviews;
        let temp2 = searchResult1.reviews;

        let i = 0;
        temp1.forEach(elem => {
            if (elem.review == x){
                temp1.splice(i, 1);
            }
            i++;
        })

        let c = 0;
        temp2.forEach(elem => {
            if (elem.review == x){
                temp2.splice(c, 1);
            }
            c++;
        })
        
        const searchResult2 = await Gallery.updateOne({ _id: oid}, {$set: {"reviews": searchResult1.reviews}});
        const searchResult3 = await User.updateOne({"username": req.session.username}, {$set: {"reviews": searchResult.reviews}});
        
    } catch(err) {
        console.log(err);
        res.status(500).json({ error: "Error getting user."});
    }
});

//This get method has two endpoints going to the same rendered pug file
app.get('/addArtwork', async(req, res) => {
	res.render('pages/addArtwork', { session: req.session });
});



app.post("/addArt", async (req, res) => {
    try {
        let temp = req.body;
        temp.artist = req.session.username;

        const searchResult = await Gallery.findOne({name: temp.name});
  
        if (searchResult == null){
            const searchResult1 = await Gallery.create(temp);
        }

    } catch(err) {
        console.log(err);
        res.status(500).json({ error: "Error getting user."});
    }
});



//This get method has two endpoints going to the same rendered pug file
app.get('/addWorkshop', async(req, res) => {
	res.render('pages/addWorkshop', { session: req.session });
});



app.post("/addWorkshop", async (req, res) => {
    try {
        let temp = req.body;
        temp.user = req.session.username;
        
        const searchResult = await User.findOne({"username": req.session.username});

        let array = searchResult.workshops;

        let i = 0;
        array.forEach(elem => {
            if (elem.name == temp.name){
                i++;
            }
        })
        if (i == 0){
            array.push(temp);
        }
        
        const searchResult1 = await User.updateOne({"username": req.session.username}, {$set: {"workshops": array}});

    } catch(err) {
        console.log(err);
        res.status(500).json({ error: "Error getting user."});
    }
});


app.post("/signup", async (req, res) => {
    try {
        let x = req.body;
        
        const searchResult = await User.findOne({"username": x.user});
        console.log(searchResult);
        let temp = searchResult.workshops;

        let i = 0;
        temp.forEach(elem => {
            if (elem.name == x.name){
                elem.signed.forEach(elem1 => {
                    if (elem1.name == req.session.username){
                        i++;
                    }
                })
                if (i == 0){
                    elem.signed.push({name: req.session.username});
                }
            }
        })

        const searchResult1 = await User.updateOne({"username": x.user}, {$set: {"workshops": temp}});
        
    } catch(err) {
        console.log(err);
        res.status(500).json({ error: "Error getting user."});
    }
});


// Create an async function to load the data.
// Other mongoose calls that return promise (connect) 
// inside the async function can use an await.
const loadData = async () => {
	
	//Connect to the mongo database
  	const result = await connect('mongodb://localhost:27017/TP');
    return result;

};

// Call to load the data.
// Once the loadData Promise returns the express server will listen.
// Any errors from connect, dropDatabase or create will be caught 
// in the catch statement.
loadData()
  .then(() => {

    app.listen(PORT);
    console.log("Listen on port:", PORT);

  })
  .catch(err => console.log(err));
