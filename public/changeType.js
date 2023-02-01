window.addEventListener('load', (event) => {
    document.getElementById("accType").addEventListener("click", changeType);
});


function changeType(){
    let accType = document.getElementById("accType1").value;
    let temp = {value: accType};
    let xhttp = new XMLHttpRequest()
        xhttp.onreadystatechange = function() {
            if (this.readyState == 4 && this.status == 200) {
            }
        }
        xhttp.open("POST", "/accType");
        xhttp.setRequestHeader("Content-Type", "application/json");
        xhttp.send(JSON.stringify(temp));

        location.reload();
}