//Import the mongoose module
import pkg from 'mongoose';

//mongoose modules -- you will need to add type": "module" to your package.json
const { Schema, model} = pkg;

//Define the Schema for a citizen
const galleries = Schema({
    name: String,
    artist: String,
    year: String,
    category: String,
    medium: String,
    description: String,
    image: String,
    reviews: [],
    numLikes: []
});

//Export the default so it can be imported
export default model("galleries", galleries);