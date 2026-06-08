from flask import Blueprint, jsonify, render_template

from worldcup_service import build_worldcup_payload


worldcup_bp = Blueprint("worldcup", __name__, url_prefix="/")


@worldcup_bp.route("/coupe-du-monde", methods=["GET"])
def worldcup_page():
    data = build_worldcup_payload()
    return render_template(
        "worldcup.html",
        active_page="wc",
        wc=data,
    )


@worldcup_bp.route("/api/coupe-du-monde", methods=["GET"])
def worldcup_api():
    return jsonify({"success": True, **build_worldcup_payload()})
