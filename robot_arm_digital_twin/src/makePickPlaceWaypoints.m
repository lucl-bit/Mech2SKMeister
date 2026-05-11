function [tforms, names] = makePickPlaceWaypoints(task)
%MAKEPICKPLACEWAYPOINTS Convert task positions to end-effector transforms.

positions = [
    task.homePosition;
    task.pickApproach;
    task.pickPose;
    task.pickApproach;
    task.placeApproach;
    task.placePose;
    task.placeApproach;
    task.homePosition
];

names = [
    "home";
    "pick_approach";
    "pick";
    "lift_after_pick";
    "place_approach";
    "place";
    "lift_after_place";
    "home_return"
];

orientation = eul2tform(task.toolRPY, "XYZ");
tforms = zeros(4, 4, size(positions, 1));

for i = 1:size(positions, 1)
    tforms(:, :, i) = trvec2tform(positions(i, :)) * orientation;
end
end
