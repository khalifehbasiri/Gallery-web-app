function follow(id){
    console.log("here");
    let temp = {value: id};
    console.log(temp);
    let xhttp = new XMLHttpRequest()
    xhttp.onreadystatechange = function() {
        if (this.readyState == 4 && this.status == 200) {
        }
    }
    xhttp.open("POST", "/follow");
    xhttp.setRequestHeader("Content-Type", "application/json");
    xhttp.send(JSON.stringify(temp));

    location.reload();
}