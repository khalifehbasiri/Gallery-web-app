function like(param){
    let x = document.getElementById(`like${param}`).value;
    let temp = {value: x};
    let xhttp = new XMLHttpRequest()
        xhttp.onreadystatechange = function() {
            if (this.readyState == 4 && this.status == 200) {
            }
        }
        xhttp.open("POST", "/like");
        xhttp.setRequestHeader("Content-Type", "application/json");
        xhttp.send(JSON.stringify(temp));

        location.reload();
}