function addreview(i){
    let id = document.getElementById(`yes${i}`).value;
    let Input = document.getElementById(`rInput${i}`).value;
    let temp = {value: Input, id: id};
    let xhttp = new XMLHttpRequest()
        xhttp.onreadystatechange = function() {
            if (this.readyState == 4 && this.status == 200) {
            }
        }
        console.log(temp);
        xhttp.open("POST", "/rsubmit");
        xhttp.setRequestHeader("Content-Type", "application/json");
        xhttp.send(JSON.stringify(temp));

        location.reload();
}