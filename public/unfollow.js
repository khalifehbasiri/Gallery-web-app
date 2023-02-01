function unfollow(username){
    console.log("here11");
    let to_unfollow = username;
    let temp = {value: to_unfollow};
    let xhttp = new XMLHttpRequest()
    xhttp.onreadystatechange = function() {
        if (this.readyState == 4 && this.status == 200) {
        }
    }
    xhttp.open("POST", "/unfollow");
    xhttp.setRequestHeader("Content-Type", "application/json");
    xhttp.send(JSON.stringify(temp));
    
    location.reload();
}