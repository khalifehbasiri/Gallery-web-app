function search(){
    let name = document.getElementById("Sname").value;
    let artist = document.getElementById("Sartist").value;
    let category = document.getElementById("Scategory").value;

    let temp = {};

    
    if (name != "" && artist != "" && category != ""){
        temp = {
            name: name,
            artist: artist,
            category: category
        }
    }else if (name != "" && artist != "" && category == ""){
        temp = {
            name: name,
            artist: artist,
        }
    }else if (name != "" && artist == "" && category != ""){
        temp = {
            name: name,
            category: category
        }
    }else if (name != "" && artist == "" && category == ""){
        temp = {
            name: name,
        }
    }else if (name == "" && artist != "" && category != ""){
        temp = {
            artist: artist,
            category: category
        }
    }else if (name == "" && artist != "" && category == ""){
        temp = {
            artist: artist,
        }
    }else if (name == "" && artist == "" && category != ""){
        temp = {
            category: category
        }
    }

    if (Object.keys(temp).length != 0){
        let xhttp = new XMLHttpRequest()
        xhttp.onload = function() {
            if (this.status >= 200 && this.status < 300) {
                window.location.href = "/searchArt";
            } else {
                alert("The artwork search could not be completed. Please try again.");
            }
        }
        xhttp.onerror = function() {
            alert("Could not connect to the server. Please try again.");
        }
        xhttp.open("POST", "/searchArt");
        xhttp.setRequestHeader("Content-Type", "application/json");
        xhttp.send(JSON.stringify(temp));
    }
}
