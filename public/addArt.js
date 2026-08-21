function add_art(){
    let RequiredFields = ["name", "year", "category", "medium", "description"]
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

    let image = document.getElementById("Aimage").files[0];
    if (!image){
        alert("Missing image field!");
        return;
    }

    let formData = new FormData();
    for (let field of RequiredFields){
        formData.append(field, art[field]);
    }
    formData.append("image", image);

    let xhttp = new XMLHttpRequest()

    xhttp.onload = function() {
        if (this.status >= 200 && this.status < 300) {
            window.location.href = "/Account";
        } else {
            alert("The artwork could not be added. Please try again.");
        }
    };
    xhttp.open("POST", "/addArt");
    xhttp.send(formData);
}
