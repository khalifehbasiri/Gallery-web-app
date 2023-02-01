let urlRegex = /((([A-Za-z]{3,9}:(?:\/\/)?)(?:[-;:&=\+\$,\w]+@)?[A-Za-z0-9.-]+|(?:www.|[-;:&=\+\$,\w]+@)[A-Za-z0-9.-]+)((?:\/[\+~%\/.\w-_]*)?\??(?:[-\+=&;%@.\w_]*)#?(?:[\w]*))?)/;

function add_art(){
    let name = document.getElementById("Aname").value;
    let year = document.getElementById("Ayear").value;
    let category = document.getElementById("Acategory").value;
    let medium = document.getElementById("Amedium").value;
    let description = document.getElementById("Adescription").value;
    let image = document.getElementById("Aimage").value;

    if (name == ""){
        alert("Missing name field!");
        return;
    }
    if (year == ""){
        alert("Missing year field!");
        return;
    }
    if (category == ""){
        alert("Missing category field!");
        return;
    }
    if (medium == ""){
        alert("Missing medium field!");
        return;
    }
    if (description == ""){
        alert("Missing description field!");
        return;
    }
    if (image == ""){
        alert("Missing image field!");
        return;
    }
    if (isNaN(year)){
        alert("year must be a number!");
        return;
    }

    if (!(urlRegex.test(image))){
        alert("image must be a valid url");
        return;
    }


    let temp = {
        name: name,
        artist: "",
        year: year,
        category: category,
        medium: medium,
        description: description,
        image: image,
        reviews: [],
        numLikes: []
    }

    let xhttp = new XMLHttpRequest()
    xhttp.onreadystatechange = function() {
        if (this.readyState == 4 && this.status == 200) {
        }
    }
    xhttp.open("POST", "/addArt");
    xhttp.setRequestHeader("Content-Type", "application/json");
    xhttp.send(JSON.stringify(temp));
    
    location.reload();
}