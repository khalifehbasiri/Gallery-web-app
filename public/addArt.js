let urlRegex = /((([A-Za-z]{3,9}:(?:\/\/)?)(?:[-;:&=\+\$,\w]+@)?[A-Za-z0-9.-]+|(?:www.|[-;:&=\+\$,\w]+@)[A-Za-z0-9.-]+)((?:\/[\+~%\/.\w-_]*)?\??(?:[-\+=&;%@.\w_]*)#?(?:[\w]*))?)/;

function add_art(){
    let RequiredFields = ["name", "year", "category", "medium", "description", "image"]
    let art = {}

    for (let field of RequiredFields){
        art[field] = document.getElementById("A" + field).value;

        if (art[field] == ""){
            alert("Missing " + field + " field!");
            return;
        } 
    }

    if (isNaN(art.year)){
        alert("year must be a number!");
        return;
    }

    if (!(urlRegex.test(art.image))){
        alert("image must be a valid url");
        return;
    }

    art.artist = "";
    art.reviews = [];
    art.numLikes = [];

    let xhttp = new XMLHttpRequest()

    xhttp.onload = function() {
        if (this.status >= 200 && this.status < 300) {
            window.location.href = "/Account";
        } else {
            alert("The artwork could not be added. Please try again.");
        }
    };
    xhttp.open("POST", "/addArt");
    xhttp.setRequestHeader("Content-Type", "application/json");
    xhttp.send(JSON.stringify(art));
}