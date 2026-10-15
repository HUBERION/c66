let con_show = false;

(function() {
    
    var _old_alert = window.alert;
    window.alert = function() {
        //breakpoint
        //
        if (document.getElementById("use_output").checked == true)
        {
            if (arguments[0]=="finished")
                document.getElementById("con_output").innerHTML+="\n<div style='color: grey;'>-----</div>\n";
            else {
                document.getElementById("con_output").innerHTML+=arguments[0];
                document.getElementById("con_output").scrollTop = document.getElementById("con_output").scrollHeight;
            }
            if (document.getElementById("add_newline").checked)
                document.getElementById("con_output").innerHTML+="\n";
        }
        else
        {
            _old_alert.apply(window,arguments);
        }
    };
})();

document.addEventListener("DOMContentLoaded", function(){
    document.getElementById("playButton").accessKey = "p";
    document.getElementById("stopButton").accessKey = "x";

    document.getElementById("visualStackContainer").style["float"] = "left";

    st = document.getElementById("statementsToolbar");
    tt = document.getElementById("toolsToolbar");
    div = document.createElement("div");
    div.style = "position: fixed; top: 0px; left: 0px; z-index: 1;";
    st.parentNode.insertBefore(div, st);
    div.appendChild(st);
    div.appendChild(document.createElement("br"));
    div.appendChild(tt);
    div.parentNode.insertBefore(document.createElement("br"), div);
    div.parentNode.insertBefore(document.createElement("br"), div);
//    div.parentNode.insertBefore(document.createElement("br"), div);
    div.parentNode.insertBefore(document.createElement("br"), div);
    div.parentNode.insertBefore(document.createElement("br"), div);
    //div.appendChild(document.createElement("br"));
    st.style["z-index"] = 1;
    tt.style["z-index"] = 1;
    tt.style["margin-bottom"] = "0px";

    dark_mode();
});

function show_console_click()
{
    con_show=!con_show;
    document.getElementById("out").style.display = con_show?"block":"none"; 
    document.getElementById("use_output").checked = con_show;
}

function dark_mode()
{
    document.body.classList.toggle("dark-mode");
}