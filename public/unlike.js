function unlike(param){
    let x = document.getElementById(`unlike${param}`).value;
    let temp = {value: x};
    let xhttp = new XMLHttpRequest()
        xhttp.onreadystatechange = function() {
            if (this.readyState == 4 && this.status == 200) {
            }
        }
        xhttp.open("POST", "/unlike");
        xhttp.setRequestHeader("Content-Type", "application/json");
        xhttp.send(JSON.stringify(temp));

        location.reload();
}