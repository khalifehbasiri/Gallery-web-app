function remove_Review(review, i){
    let to_remove = review;
    console.log(i);
    let id = document.getElementById(`yes${i}`).value;
    let temp = {value: to_remove, id: id};
    let xhttp = new XMLHttpRequest()
    xhttp.onreadystatechange = function() {
        if (this.readyState == 4 && this.status == 200) {
        }
    }
    xhttp.open("POST", "/rRemove");
    xhttp.setRequestHeader("Content-Type", "application/json");
    xhttp.send(JSON.stringify(temp));
    
    location.reload();
}