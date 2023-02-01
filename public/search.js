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
        xhttp.onreadystatechange = function() {
            if (this.readyState == 4 && this.status == 200) {
            }
        }
        xhttp.open("POST", "/searchArt");
        xhttp.setRequestHeader("Content-Type", "application/json");
        xhttp.send(JSON.stringify(temp));

        location.reload();
    }
}